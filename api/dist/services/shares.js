import { getMilliseconds } from "../utils/get-milliseconds.js";
import { useLogger } from "../logger/index.js";
import { scopedCachePurgeEnabled } from "../scoped-cache/config.js";
import "../scoped-cache/index.js";
import { validateAccess } from "../permissions/modules/validate-access/validate-access.js";
import { clearPermissionsCacheAfterCommit } from "../utils/clear-caches-after-commit.js";
import { validateKeys } from "../utils/validate-keys.js";
import { ItemsService } from "./items.js";
import { getSecret } from "../utils/get-secret.js";
import { Url } from "../utils/url.js";
import { userName } from "../utils/user-name.js";
import { md } from "../utils/md.js";
import { MailService } from "./mail/index.js";
import { UsersService } from "./users.js";
import { useEnv } from "@directus/env";
import { ForbiddenError, InvalidCredentialsError, ItemNotFoundError } from "@directus/errors";
import argon2 from "argon2";
import { nanoid } from "nanoid";
import jwt from "jsonwebtoken";

//#region src/services/shares.ts
const env = useEnv();
const logger = useLogger();
var SharesService = class extends ItemsService {
	constructor(options) {
		super("directus_shares", options);
	}
	async createMany(data, opts) {
		if (this.accountability) await this.validateShareAccess(this.accountability, data);
		return super.createMany(data, opts);
	}
	async updateGroups(groups, opts) {
		if (this.accountability) await this.validateShareAccess(this.accountability, await this.readUpdatedShareTargets(groups));
		const updatedKeys = await super.updateGroups(groups, opts);
		await clearPermissionsCacheAfterCommit(this.knex);
		return updatedKeys;
	}
	/**
	* Where each row of the update points once written. A change setting neither
	* `collection` nor `item` keeps its target, so it reads nothing and is not
	* checked; one setting a single half takes the other from the stored row.
	*/
	async readUpdatedShareTargets(groups) {
		const repointingGroups = groups.filter((group) => {
			return group.data["collection"] !== void 0 || group.data["item"] !== void 0;
		});
		const halfSetKeys = repointingGroups.filter((group) => {
			return group.data["collection"] === void 0 || group.data["item"] === void 0;
		}).flatMap((group) => group.keys);
		const storedTargets = /* @__PURE__ */ new Map();
		if (halfSetKeys.length > 0) {
			validateKeys(this.schema, this.collection, "id", halfSetKeys);
			const storedRows = await this.knex.select("id", "collection", "item").from("directus_shares").whereIn("id", halfSetKeys);
			for (const storedRow of storedRows) storedTargets.set(this.primaryKeyNameOf(storedRow.id), storedRow);
		}
		return repointingGroups.flatMap((group) => {
			return group.keys.map((key) => {
				const storedTarget = storedTargets.get(this.primaryKeyNameOf(key));
				const collection = group.data["collection"] ?? storedTarget?.collection;
				const item = group.data["item"] ?? storedTarget?.item;
				if (collection === void 0 || item === void 0) {
					if (this.accountability?.admin === true) throw new ItemNotFoundError({
						collection: this.collection,
						primaryKey: key
					});
					throw new ForbiddenError({ reason: `You don't have permission to perform "update" for collection "${this.collection}" or it does not exist.` });
				}
				return {
					collection,
					item
				};
			});
		});
	}
	/**
	* Refuses unless the caller may share every target, one read per collection.
	*/
	async validateShareAccess(accountability, shareTargets) {
		const sharedKeysByCollection = /* @__PURE__ */ new Map();
		for (const shareTarget of shareTargets) {
			const sharedKeys = sharedKeysByCollection.get(shareTarget.collection) ?? /* @__PURE__ */ new Map();
			sharedKeys.set(String(shareTarget.item), shareTarget.item);
			sharedKeysByCollection.set(shareTarget.collection, sharedKeys);
		}
		for (const [collection, sharedKeys] of sharedKeysByCollection) await validateAccess({
			accountability,
			action: "share",
			collection,
			primaryKeys: [...sharedKeys.values()]
		}, {
			schema: this.schema,
			knex: this.knex
		});
	}
	async deleteMany(keys, opts) {
		const deletedKeys = await super.deleteMany(keys, opts);
		await clearPermissionsCacheAfterCommit(this.knex);
		return deletedKeys;
	}
	async login(payload, options) {
		const record = await this.knex.select({
			share_id: "id",
			share_start: "date_start",
			share_end: "date_end",
			share_times_used: "times_used",
			share_max_uses: "max_uses",
			share_password: "password"
		}).from("directus_shares").where("id", payload["share"]).andWhere((subQuery) => {
			subQuery.whereNull("date_end").orWhere("date_end", ">=", /* @__PURE__ */ new Date());
		}).andWhere((subQuery) => {
			subQuery.whereNull("date_start").orWhere("date_start", "<=", /* @__PURE__ */ new Date());
		}).andWhere((subQuery) => {
			subQuery.whereNull("max_uses").orWhere("max_uses", ">=", this.knex.ref("times_used"));
		}).first();
		if (!record) throw new InvalidCredentialsError();
		if (record.share_password && !await argon2.verify(record.share_password, payload["password"])) throw new InvalidCredentialsError();
		await new ItemsService("directus_shares", {
			knex: this.knex,
			schema: this.schema
		}).updateOne(record.share_id, { times_used: record.share_times_used + 1 }, {
			emitEvents: false,
			autoPurgeCache: scopedCachePurgeEnabled()
		});
		const tokenPayload = {
			app_access: false,
			admin_access: false,
			role: null,
			share: record.share_id
		};
		const refreshToken = nanoid(64);
		const refreshTokenExpiration = new Date(Date.now() + getMilliseconds(env["REFRESH_TOKEN_TTL"], 0));
		if (options?.session) tokenPayload.session = refreshToken;
		const TTL = env[options?.session ? "SESSION_COOKIE_TTL" : "ACCESS_TOKEN_TTL"];
		const accessToken = jwt.sign(tokenPayload, getSecret(), {
			expiresIn: TTL,
			issuer: "directus"
		});
		await this.knex("directus_sessions").insert({
			token: refreshToken,
			expires: refreshTokenExpiration,
			ip: this.accountability?.ip,
			user_agent: this.accountability?.userAgent,
			origin: this.accountability?.origin,
			share: record.share_id
		});
		await this.knex("directus_sessions").delete().where("expires", "<", /* @__PURE__ */ new Date());
		return {
			accessToken,
			refreshToken,
			expires: getMilliseconds(TTL)
		};
	}
	/**
	* Send a link to the given share ID to the given email(s). Note: you can only send a link to a share
	* if you have read access to that particular share
	*/
	async invite(payload) {
		if (!this.accountability?.user) throw new ForbiddenError({ reason: "You must be authenticated to send a share invite." });
		const share = await this.readOne(payload.share, { fields: ["collection"] });
		const usersService = new UsersService({
			knex: this.knex,
			schema: this.schema
		});
		const mailService = new MailService({
			schema: this.schema,
			accountability: this.accountability
		});
		const userInfo = await usersService.readOne(this.accountability.user, { fields: [
			"first_name",
			"last_name",
			"email",
			"id"
		] });
		const message = `
Hello!

${userName(userInfo)} has invited you to view an item in ${share["collection"]}.

[Open](${new Url(env["PUBLIC_URL"]).addPath("admin", "shared", payload.share).toString()})
`;
		for (const email of payload.emails) mailService.send({
			template: {
				name: "base",
				data: { html: md(message) }
			},
			to: email,
			subject: `${userName(userInfo)} has shared an item with you`
		}).catch((error) => {
			logger.error(error, `Could not send share notification mail`);
		});
	}
};

//#endregion
export { SharesService };