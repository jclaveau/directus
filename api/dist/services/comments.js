import { useLogger } from "../logger/index.js";
import { isValidUuid } from "../utils/is-valid-uuid.js";
import { fetchRolesTree } from "../permissions/lib/fetch-roles-tree.js";
import { fetchGlobalAccess } from "../permissions/modules/fetch-global-access/fetch-global-access.js";
import { validateAccess } from "../permissions/modules/validate-access/validate-access.js";
import { ItemsService } from "./items.js";
import { Url } from "../utils/url.js";
import { userName } from "../utils/user-name.js";
import { UsersService } from "./users.js";
import { NotificationsService } from "./notifications.js";
import { useEnv } from "@directus/env";
import { ErrorCode, ForbiddenError, InvalidPayloadError, isDirectusError } from "@directus/errors";
import { uniq } from "lodash-es";

//#region src/services/comments.ts
const env = useEnv();
const logger = useLogger();
var CommentsService = class extends ItemsService {
	notificationsService;
	usersService;
	constructor(options) {
		super("directus_comments", options);
		this.notificationsService = new NotificationsService({ schema: this.schema });
		this.usersService = new UsersService({ schema: this.schema });
	}
	async createOne(data, opts) {
		if (!this.accountability?.user) throw new ForbiddenError();
		if (!data["comment"]) throw new InvalidPayloadError({ reason: `"comment" is required` });
		if (!data["collection"]) throw new InvalidPayloadError({ reason: `"collection" is required` });
		if (!data["item"]) throw new InvalidPayloadError({ reason: `"item" is required` });
		if (this.accountability) await validateAccess({
			accountability: this.accountability,
			action: "read",
			collection: data["collection"],
			primaryKeys: [data["item"]]
		}, {
			schema: this.schema,
			knex: this.knex
		});
		const result = await super.createOne(data, opts);
		const usersRegExp = /* @__PURE__ */ new RegExp(/@[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}/gi);
		const mentions = uniq(data["comment"].match(usersRegExp) ?? []);
		if (mentions.length === 0) return result;
		const sender = await this.usersService.readOne(this.accountability.user, { fields: [
			"id",
			"first_name",
			"last_name",
			"email"
		] });
		for (const mention of mentions) {
			const userID = mention.substring(1);
			const user = await this.usersService.readOne(userID, { fields: [
				"id",
				"first_name",
				"last_name",
				"email",
				"role.id"
			] });
			const accountability = {
				user: userID,
				role: user["role"]?.id ?? null,
				admin: false,
				app: false,
				roles: await fetchRolesTree(user["role"]?.id ?? null, { knex: this.knex }),
				ip: null
			};
			const userGlobalAccess = await fetchGlobalAccess(accountability, { knex: this.knex });
			accountability.admin = userGlobalAccess.admin;
			accountability.app = userGlobalAccess.app;
			const usersService = new UsersService({
				schema: this.schema,
				accountability
			});
			try {
				await validateAccess({
					accountability,
					action: "read",
					collection: data["collection"],
					primaryKeys: [data["item"]]
				}, {
					schema: this.schema,
					knex: this.knex
				});
				const userPreviews = (await usersService.readByQuery({
					fields: [
						"id",
						"first_name",
						"last_name",
						"email"
					],
					filter: { id: { _in: mentions.map((mention$1) => mention$1.substring(1)) } }
				})).reduce((acc, user$1) => {
					acc[user$1["id"]] = `<em>${userName(user$1)}</em>`;
					return acc;
				}, {});
				let comment = data["comment"];
				for (const mention$1 of mentions) {
					const uuid = mention$1.substring(1);
					if (isValidUuid(uuid) === false) continue;
					comment = comment.replace(new RegExp(mention$1, "gm"), userPreviews[uuid] ?? "@Unknown User");
				}
				comment = `> ${comment.replace(/\n+/gm, "\n> ")}`;
				const href = new Url(env["PUBLIC_URL"]).addPath("admin", "content", data["collection"], data["item"]).toString();
				const message = `
Hello ${userName(user)},

${userName(sender)} has mentioned you in a comment:

${comment}

<a href="${href}">Click here to view.</a>
`;
				await this.notificationsService.createOne({
					recipient: userID,
					sender: sender["id"],
					subject: `You were mentioned in ${data["collection"]}`,
					message,
					collection: data["collection"],
					item: data["item"]
				});
			} catch (err) {
				if (isDirectusError(err, ErrorCode.Forbidden)) logger.warn(`User ${userID} doesn't have proper permissions to receive notification for this item.`);
				else throw err;
			}
		}
		return result;
	}
	updateOne(key, data, opts) {
		if (!this.accountability?.user) throw new ForbiddenError();
		return super.updateOne(key, data, opts);
	}
	deleteOne(key, opts) {
		if (!this.accountability?.user) throw new ForbiddenError();
		return super.deleteOne(key, opts);
	}
};

//#endregion
export { CommentsService };