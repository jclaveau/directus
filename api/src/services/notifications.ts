import { useEnv } from '@directus/env';
import type { AbstractServiceOptions, MutationOptions, Notification, PrimaryKey } from '@directus/types';
import type { Knex } from 'knex';
import { useLogger } from '../logger/index.js';
import { fetchRolesTree } from '../permissions/lib/fetch-roles-tree.js';
import { fetchGlobalAccess } from '../permissions/modules/fetch-global-access/fetch-global-access.js';
import { md } from '../utils/md.js';
import { queueAfterCommit } from '../utils/transaction.js';
import { Url } from '../utils/url.js';
import { ItemsService } from './items.js';
import { MailService } from './mail/index.js';
import { UsersService } from './users.js';

const env = useEnv();
const logger = useLogger();

export class NotificationsService extends ItemsService<Notification> {
	constructor(options: AbstractServiceOptions) {
		super('directus_notifications', options);
	}

	override async createMany(data: Partial<Notification>[], opts?: MutationOptions): Promise<PrimaryKey[]> {
		const primaryKeys = await super.createMany(data, opts);

		// A notification created in a transaction (an import) is emailed once its row
		// commits: a rolled-back one sends nothing.
		const sendEmails = async (database: Knex) => {
			const notificationsService = new NotificationsService({
				schema: this.schema,
				knex: database,
				accountability: this.accountability,
			});

			for (const notification of data) {
				await notificationsService.sendEmail(notification);
			}
		};

		if (!queueAfterCommit(this.knex, sendEmails)) {
			await sendEmails(this.knex);
		}

		return primaryKeys;
	}

	async sendEmail(data: Partial<Notification>) {
		if (data.recipient) {
			const usersService = new UsersService({ schema: this.schema, knex: this.knex });

			const user = await usersService.readOne(data.recipient, {
				fields: ['id', 'email', 'email_notifications', 'role'],
			});

			if (user['email'] && user['email_notifications'] === true) {
				const manageUserAccountUrl = new Url(env['PUBLIC_URL'] as string)
					.addPath('admin', 'users', user['id'])
					.toString();

				const html = data.message ? md(data.message) : '';
				const roles = await fetchRolesTree(user['role'], this.knex);

				const { app: app_access } = await fetchGlobalAccess(
					{
						user: user['id'],
						roles,
						ip: null,
					},
					this.knex,
				);

				const mailService = new MailService({
					schema: this.schema,
					knex: this.knex,
					accountability: this.accountability,
				});

				mailService
					.send({
						template: {
							name: 'base',
							data: app_access ? { url: manageUserAccountUrl, html } : { html },
						},
						to: user['email'],
						subject: data.subject,
					})
					.catch((error) => {
						logger.error(error, `Could not send notification via mail`);
					});
			}
		}
	}
}
