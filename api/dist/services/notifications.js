import { useLogger } from "../logger/index.js";
import { queueAfterCommit } from "../utils/transaction.js";
import emitter_default from "../emitter.js";
import { fetchRolesTree } from "../permissions/lib/fetch-roles-tree.js";
import { fetchGlobalAccess } from "../permissions/modules/fetch-global-access/fetch-global-access.js";
import { ItemsService } from "./items.js";
import { Url } from "../utils/url.js";
import { md } from "../utils/md.js";
import { MailService } from "./mail/index.js";
import { UsersService } from "./users.js";
import { useEnv } from "@directus/env";

//#region src/services/notifications.ts
const env = useEnv();
const logger = useLogger();
var NotificationsService = class extends ItemsService {
	constructor(options) {
		super("directus_notifications", options);
	}
	async sendEmail(data) {
		if (data.recipient) {
			const user = await new UsersService({
				schema: this.schema,
				knex: this.knex
			}).readOne(data.recipient.id ?? data.recipient, { fields: [
				"id",
				"email",
				"email_notifications",
				"role"
			] });
			if (user["email"] && user["email_notifications"] === true) {
				const manageUserAccountUrl = new Url(env["PUBLIC_URL"]).addPath("admin", "users", user["id"]).toString();
				const html = data.message ? md(data.message) : "";
				const roles = await fetchRolesTree(user["role"], this.knex);
				const { app: app_access } = await fetchGlobalAccess({
					user: user["id"],
					roles,
					ip: null
				}, this.knex);
				new MailService({
					schema: this.schema,
					knex: this.knex,
					accountability: this.accountability
				}).send({
					template: {
						name: "base",
						data: app_access ? {
							url: manageUserAccountUrl,
							html
						} : { html }
					},
					to: user["email"],
					subject: data.subject
				}).catch((error) => {
					logger.error(error, `Could not send notification via mail`);
				});
			}
		}
	}
};
/**
* Email the notifications a create wrote, as written, once the transaction they
* were written in commits: none for a row a filter hook cancelled, took over or
* pointed at another, none for a row rolled back with a caller's transaction
* (a filter flow's), none for a create with `emitEvents: false`. A savepoint
* rolled back inside a transaction that then commits still emails its rows:
* `queueAfterCommit` keeps a savepoint's tasks.
*/
function initNotificationEmails() {
	emitter_default.onFilter("notifications.created", async (writtenNotifications, _meta, context) => {
		const { transaction, schema, accountability } = context;
		const sendEmails = async (database) => {
			const notificationsService = new NotificationsService({
				schema,
				knex: database,
				accountability
			});
			for (const notification of writtenNotifications) try {
				await notificationsService.sendEmail(notification);
			} catch (error) {
				logger.error(error, `Could not send notification via mail`);
			}
		};
		if (!queueAfterCommit(transaction, sendEmails)) await sendEmails(transaction);
	});
}

//#endregion
export { NotificationsService, initNotificationEmails };