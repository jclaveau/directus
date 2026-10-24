import { useEnv } from '@directus/env';
import {
	ErrorCode,
	ForbiddenError,
	InvalidPayloadError,
	isDirectusError,
	ItemNotFoundError,
} from '@directus/errors';
import type { AbstractServiceOptions, Accountability, Comment, MutationOptions, PrimaryKey } from '@directus/types';
import { useLogger } from '../logger/index.js';
import { fetchRolesTree } from '../permissions/lib/fetch-roles-tree.js';
import { fetchGlobalAccess } from '../permissions/modules/fetch-global-access/fetch-global-access.js';
import { validateAccess } from '../permissions/modules/validate-access/validate-access.js';
import { isValidUuid } from '../utils/is-valid-uuid.js';
import { uniq } from '../utils/lodash-es-used.js';
import { Url } from '../utils/url.js';
import { userName } from '../utils/user-name.js';
import { ItemsService } from './items.js';
import { NotificationsService } from './notifications.js';
import { UsersService } from './users.js';

const env = useEnv();
const logger = useLogger();

export class CommentsService extends ItemsService {
	notificationsService: NotificationsService;
	usersService: UsersService;

	constructor(options: AbstractServiceOptions) {
		super('directus_comments', options);
		this.notificationsService = new NotificationsService({ schema: this.schema });
		this.usersService = new UsersService({ schema: this.schema });
	}

	override async createMany(data: Partial<Comment>[], opts?: MutationOptions): Promise<PrimaryKey[]> {
		if (!this.accountability?.user) throw new ForbiddenError();

		for (const item of data) {
			if (!item['comment']) {
				throw new InvalidPayloadError({ reason: `"comment" is required` });
			}

			if (!item['collection']) {
				throw new InvalidPayloadError({ reason: `"collection" is required` });
			}

			if (!item['item']) {
				throw new InvalidPayloadError({ reason: `"item" is required` });
			}

			if (this.accountability) {
				await validateAccess(
					{
						accountability: this.accountability,
						action: 'read',
						collection: item['collection'],
						primaryKeys: [item['item']],
					},
					{
						schema: this.schema,
						knex: this.knex,
					},
				);
			}
		}

		const usersRegExp = new RegExp(/@[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}/gi);

		const mentionsByItem = data.map((item) => {
			return uniq(item['comment']!.match(usersRegExp) ?? []);
		});

		// A uuid is case-insensitive (RFC 9562), and Directus stores it lowercase.
		const mentionedIds = uniq(mentionsByItem.flat()
			.map((mention) => mention.substring(1).toLowerCase()));

		// Resolved before the insert: an admin's mention of a missing user
		// refuses the comment instead of failing after it is written.
		const authorReadableIds = mentionedIds.length === 0
			? new Set<string>()
			: await this.readableUserIds(mentionedIds);

		const keys = await super.createMany(data, opts);

		for (const [itemIndex, item] of data.entries()) {
			const mentions = mentionsByItem[itemIndex]!;

			if (mentions.length === 0) {
				continue;
			}

			// Validated non-null in the pre-insert loop above.
			const collection = item['collection']!;
			const itemKey = item['item']!;

			const sender = await this.usersService.readOne(this.accountability.user, {
				fields: ['id', 'first_name', 'last_name', 'email'],
			});

			// Two spellings of one uuid mention one user, who is notified once;
			// the preview below still replaces every spelling the comment holds.
			const mentionedUserIds = uniq(mentions.map((mention) => {
				return mention.substring(1).toLowerCase();
			}));

			for (const userID of mentionedUserIds) {
				if (!authorReadableIds.has(userID)) {
					logger.warn(
						`Mention of user "${userID}" skipped:`
						+ ' the author cannot read that user',
					);

					continue;
				}

				const user = await this.usersService.readOne(userID, {
					fields: ['id', 'first_name', 'last_name', 'email', 'role.id'],
				});

				const accountability: Accountability = {
					user: userID,
					role: user['role']?.id ?? null,
					admin: false,
					app: false,
					roles: await fetchRolesTree(user['role']?.id ?? null, this.knex),
					ip: null,
				};

				const userGlobalAccess = await fetchGlobalAccess(accountability, this.knex);

				accountability.admin = userGlobalAccess.admin;
				accountability.app = userGlobalAccess.app;

				const usersService = new UsersService({ schema: this.schema, accountability });

				try {
					await validateAccess(
						{
							accountability,
							action: 'read',
							collection: collection,
							primaryKeys: [itemKey],
						},
						{
							schema: this.schema,
							knex: this.knex,
						},
					);

					const templateData = await usersService.readByQuery({
						fields: ['id', 'first_name', 'last_name', 'email'],
						filter: {
							id: {
								_in: mentionedUserIds,
							},
						},
					}).catch((error: unknown) => {
						// The recipient is notified all the same: a user they may not
						// read is previewed as "@Unknown User".
						if (!isDirectusError(error, ErrorCode.Forbidden)) {
							throw error;
						}

						return [];
					});

					const userPreviews = templateData.reduce(
						(acc, user) => {
							acc[user['id']] = `<em>${userName(user)}</em>`;
							return acc;
						},
						{} as Record<string, string>,
					);

					let comment = item['comment']!;

					for (const mention of mentions) {
						const uuid = mention.substring(1).toLowerCase();
						// We only match on UUIDs in the first place. This is just an extra sanity check.
						if (isValidUuid(uuid) === false) continue;
						// Literal replace (not a user-built RegExp) avoids regex injection; mention is a literal @<uuid>.
						comment = comment.replaceAll(mention, userPreviews[uuid] ?? '@Unknown User');
					}

					comment = `> ${comment.replace(/\n+/gm, '\n> ')}`;

					const href = new Url(env['PUBLIC_URL'] as string).addPath('admin', 'content', collection, itemKey).toString();

					const message = `
Hello ${userName(user)},

${userName(sender)} has mentioned you in a comment:

${comment}

<a href="${href}">Click here to view.</a>
`;

					await this.notificationsService.createOne({
						recipient: userID,
						sender: sender['id'],
						subject: `You were mentioned in ${collection}`,
						message,
						collection: collection,
						item: itemKey,
					});
				} catch (err: any) {
					if (isDirectusError(err, ErrorCode.Forbidden)) {
						logger.warn(`User ${userID} doesn't have proper permissions to receive notification for this item.`);
					} else {
						throw err;
					}
				}
			}
		}

		return keys;
	}

	private async readableUserIds(userIds: string[]): Promise<Set<string>> {
		const authorUsersService = new UsersService({
			schema: this.schema,
			knex: this.knex,
			accountability: this.accountability,
		});

		const readableUsers = await authorUsersService.readByQuery({
			fields: ['id'],
			filter: { id: { _in: userIds } },
			limit: -1,
		}).catch((error: unknown) => {
			if (!isDirectusError(error, ErrorCode.Forbidden)) {
				throw error;
			}

			return [];
		});

		const readableIds = new Set<string>(readableUsers.map((readableUser) => {
			return String(readableUser['id']).toLowerCase();
		}));

		// Only an admin may learn a user is missing: anyone else cannot tell it
		// from a user they may not read, so that mention is skipped.
		const missingId = this.accountability?.admin
			? userIds.find((userId) => !readableIds.has(userId.toLowerCase()))
			: undefined;

		if (missingId !== undefined) {
			throw new ItemNotFoundError({
				collection: 'directus_users',
				primaryKey: missingId,
			});
		}

		return readableIds;
	}

	override updateOne(key: PrimaryKey, data: Partial<Comment>, opts?: MutationOptions): Promise<PrimaryKey> {
		if (!this.accountability?.user) throw new ForbiddenError();

		return super.updateOne(key, data, opts);
	}

	override deleteOne(key: PrimaryKey, opts?: MutationOptions): Promise<PrimaryKey> {
		if (!this.accountability?.user) throw new ForbiddenError();

		return super.deleteOne(key, opts);
	}
}
