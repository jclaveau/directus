import { uniq } from "../utils/lodash-es-used.js";
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
import { ErrorCode, ForbiddenError, InvalidPayloadError, ItemNotFoundError, isDirectusError } from "@directus/errors";

//#region src/services/comments.ts
const env = useEnv();
const logger = useLogger();
var CommentsService = class extends ItemsService {
	notificationsService;
	usersService;
	constructor(options) {
		super("directus_comments", options);
		this.notificationsService = new NotificationsService({
			schema: this.schema,
			knex: this.knex
		});
		this.usersService = new UsersService({
			schema: this.schema,
			knex: this.knex
		});
	}
	async createMany(data, opts) {
		if (!this.accountability?.user) throw new ForbiddenError();
		for (const item of data) {
			if (!item["comment"]) throw new InvalidPayloadError({ reason: `"comment" is required` });
			if (!item["collection"]) throw new InvalidPayloadError({ reason: `"collection" is required` });
			if (!item["item"]) throw new InvalidPayloadError({ reason: `"item" is required` });
			if (this.accountability) await validateAccess({
				accountability: this.accountability,
				action: "read",
				collection: item["collection"],
				primaryKeys: [item["item"]]
			}, {
				schema: this.schema,
				knex: this.knex
			});
		}
		const usersRegExp = /* @__PURE__ */ new RegExp(/@[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}/gi);
		const mentionsByItem = data.map((item) => {
			return uniq(item["comment"].match(usersRegExp) ?? []);
		});
		const mentionedIds = uniq(mentionsByItem.flat().map((mention) => mention.substring(1).toLowerCase()));
		const authorReadableIds = mentionedIds.length === 0 ? /* @__PURE__ */ new Set() : await this.readableUserIds(mentionedIds);
		const keys = await super.createMany(data, opts);
		for (const [itemIndex, item] of data.entries()) {
			const mentions = mentionsByItem[itemIndex];
			if (mentions.length === 0) continue;
			const collection = item["collection"];
			const itemKey = item["item"];
			const sender = await this.usersService.readOne(this.accountability.user, { fields: [
				"id",
				"first_name",
				"last_name",
				"email"
			] });
			const mentionedUserIds = uniq(mentions.map((mention) => {
				return mention.substring(1).toLowerCase();
			}));
			for (const userID of mentionedUserIds) {
				if (!authorReadableIds.has(userID)) {
					logger.warn(`Mention of user "${userID}" skipped: the author cannot read that user`);
					continue;
				}
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
					roles: await fetchRolesTree(user["role"]?.id ?? null, this.knex),
					ip: null
				};
				const userGlobalAccess = await fetchGlobalAccess(accountability, this.knex);
				accountability.admin = userGlobalAccess.admin;
				accountability.app = userGlobalAccess.app;
				const usersService = new UsersService({
					schema: this.schema,
					knex: this.knex,
					accountability
				});
				try {
					await validateAccess({
						accountability,
						action: "read",
						collection,
						primaryKeys: [itemKey]
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
						filter: { id: { _in: mentionedUserIds } }
					}).catch((error) => {
						if (!isDirectusError(error, ErrorCode.Forbidden)) throw error;
						return [];
					})).reduce((acc, user$1) => {
						acc[user$1["id"]] = `<em>${userName(user$1)}</em>`;
						return acc;
					}, {});
					let comment = item["comment"];
					for (const mention of mentions) {
						const uuid = mention.substring(1).toLowerCase();
						if (isValidUuid(uuid) === false) continue;
						comment = comment.replaceAll(mention, userPreviews[uuid] ?? "@Unknown User");
					}
					comment = `> ${comment.replace(/\n+/gm, "\n> ")}`;
					const href = new Url(env["PUBLIC_URL"]).addPath("admin", "content", collection, itemKey).toString();
					const message = `
Hello ${userName(user)},

${userName(sender)} has mentioned you in a comment:

${comment}

<a href="${href}">Click here to view.</a>
`;
					await this.notificationsService.createOne({
						recipient: userID,
						sender: sender["id"],
						subject: `You were mentioned in ${collection}`,
						message,
						collection,
						item: itemKey
					}, { bypassEmitAction: opts?.bypassEmitAction });
				} catch (err) {
					if (isDirectusError(err, ErrorCode.Forbidden)) logger.warn(`User ${userID} doesn't have proper permissions to receive notification for this item.`);
					else throw err;
				}
			}
		}
		return keys;
	}
	async readableUserIds(userIds) {
		const readableUsers = await new UsersService({
			schema: this.schema,
			knex: this.knex,
			accountability: this.accountability
		}).readByQuery({
			fields: ["id"],
			filter: { id: { _in: userIds } },
			limit: -1
		}).catch((error) => {
			if (!isDirectusError(error, ErrorCode.Forbidden)) throw error;
			return [];
		});
		const readableIds = new Set(readableUsers.map((readableUser) => {
			return String(readableUser["id"]).toLowerCase();
		}));
		const missingId = this.accountability?.admin ? userIds.find((userId) => !readableIds.has(userId.toLowerCase())) : void 0;
		if (missingId !== void 0) throw new ItemNotFoundError({
			collection: "directus_users",
			primaryKey: missingId
		});
		return readableIds;
	}
	async updateGroups(groups, opts) {
		if (!this.accountability?.user) throw new ForbiddenError();
		return super.updateGroups(groups, opts);
	}
	async deleteMany(keys, opts) {
		if (!this.accountability?.user) throw new ForbiddenError();
		return super.deleteMany(keys, opts);
	}
};

//#endregion
export { CommentsService };