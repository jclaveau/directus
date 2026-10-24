import { useEnv } from '@directus/env';
import {
	ForbiddenError,
	InvalidCredentialsError,
	ItemNotFoundError,
} from '@directus/errors';
import type {
	AbstractServiceOptions,
	Accountability,
	Item,
	LoginResult,
	MutationOptions,
	PrimaryKey,
	UpdateGroup,
} from '@directus/types';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import type { StringValue } from 'ms';
import { nanoid } from 'nanoid';
import { useLogger } from '../logger/index.js';
import {
	clearPermissionsCacheAfterCommit,
} from '../utils/clear-caches-after-commit.js';
import { validateAccess } from '../permissions/modules/validate-access/validate-access.js';
import type { DirectusTokenPayload, ShareData } from '../types/index.js';
import { getMilliseconds } from '../utils/get-milliseconds.js';
import { getSecret } from '../utils/get-secret.js';
import { md } from '../utils/md.js';
import { Url } from '../utils/url.js';
import { userName } from '../utils/user-name.js';
import { validateKeys } from '../utils/validate-keys.js';
import { ItemsService } from './items.js';
import { MailService } from './mail/index.js';
import { UsersService } from './users.js';

type ShareTarget = { collection: string; item: PrimaryKey };

const env = useEnv();
const logger = useLogger();

export class SharesService extends ItemsService {
	constructor(options: AbstractServiceOptions) {
		super('directus_shares', options);
	}

	override async createMany(
		data: Partial<Item>[],
		opts?: MutationOptions,
	): Promise<PrimaryKey[]> {
		if (this.accountability) {
			await this.validateShareAccess(this.accountability, data as ShareTarget[]);
		}

		return super.createMany(data, opts);
	}

	override async updateGroups(
		groups: UpdateGroup<Item>[],
		opts?: MutationOptions,
	): Promise<PrimaryKey[]> {
		if (this.accountability) {
			await this.validateShareAccess(
				this.accountability,
				await this.readUpdatedShareTargets(groups),
			);
		}

		const updatedKeys = await super.updateGroups(groups, opts);

		await clearPermissionsCacheAfterCommit(this.knex);

		return updatedKeys;
	}

	/**
	 * Where each row of the update points once written. A change setting neither
	 * `collection` nor `item` keeps its target, so it reads nothing and is not
	 * checked; one setting a single half takes the other from the stored row.
	 */
	private async readUpdatedShareTargets(
		groups: UpdateGroup<Item>[],
	): Promise<ShareTarget[]> {
		const repointingGroups = groups.filter((group) => {
			return group.data['collection'] !== undefined
				|| group.data['item'] !== undefined;
		});

		const halfSetKeys = repointingGroups
			.filter((group) => {
				return group.data['collection'] === undefined
					|| group.data['item'] === undefined;
			})
			.flatMap((group) => group.keys);

		const storedTargets = new Map<string, ShareTarget>();

		if (halfSetKeys.length > 0) {
			validateKeys(this.schema, this.collection, 'id', halfSetKeys);

			const storedRows = await this.knex
				.select('id', 'collection', 'item')
				.from('directus_shares')
				.whereIn('id', halfSetKeys);

			for (const storedRow of storedRows) {
				storedTargets.set(this.primaryKeyNameOf(storedRow.id), storedRow);
			}
		}

		return repointingGroups.flatMap((group) => {
			return group.keys.map((key) => {
				const storedTarget = storedTargets.get(this.primaryKeyNameOf(key));
				const collection = group.data['collection'] ?? storedTarget?.collection;
				const item = group.data['item'] ?? storedTarget?.item;

				// No row holds the key: a 404 for an admin, as forbidden as a hidden
				// share for anyone else, like ItemsService.refuseMissingKeyForAdmin.
				if (collection === undefined || item === undefined) {
					if (this.accountability?.admin === true) {
						throw new ItemNotFoundError({
							collection: this.collection,
							primaryKey: key,
						});
					}

					throw new ForbiddenError({
						reason: `You don't have permission to perform "update" for`
							+ ` collection "${this.collection}" or it does not exist.`,
					});
				}

				return { collection, item };
			});
		});
	}

	/**
	 * Refuses unless the caller may share every target, one read per collection.
	 */
	private async validateShareAccess(
		accountability: Accountability,
		shareTargets: ShareTarget[],
	): Promise<void> {
		const sharedKeysByCollection = new Map<string, Map<string, PrimaryKey>>();

		for (const shareTarget of shareTargets) {
			const sharedKeys = sharedKeysByCollection.get(shareTarget.collection)
				?? new Map<string, PrimaryKey>();

			// Keyed by its string form so two shares of one item read it once:
			// validateAccess counts the rows it reads back against the keys.
			sharedKeys.set(String(shareTarget.item), shareTarget.item);
			sharedKeysByCollection.set(shareTarget.collection, sharedKeys);
		}

		for (const [collection, sharedKeys] of sharedKeysByCollection) {
			await validateAccess(
				{
					accountability,
					action: 'share',
					collection,
					primaryKeys: [...sharedKeys.values()],
				},
				{
					schema: this.schema,
					knex: this.knex,
				},
			);
		}
	}

	override async deleteMany(keys: PrimaryKey[], opts?: MutationOptions): Promise<PrimaryKey[]> {
		const deletedKeys = await super.deleteMany(keys, opts);

		await clearPermissionsCacheAfterCommit(this.knex);

		return deletedKeys;
	}

	async login(
		payload: Record<string, any>,
		options?: Partial<{
			session: boolean;
		}>,
	): Promise<Omit<LoginResult, 'id'>> {
		const record = await this.knex
			.select<ShareData>({
				share_id: 'id',
				share_start: 'date_start',
				share_end: 'date_end',
				share_times_used: 'times_used',
				share_max_uses: 'max_uses',
				share_password: 'password',
			})
			.from('directus_shares')
			.where('id', payload['share'])
			.andWhere((subQuery) => {
				subQuery.whereNull('date_end').orWhere('date_end', '>=', new Date());
			})
			.andWhere((subQuery) => {
				subQuery.whereNull('date_start').orWhere('date_start', '<=', new Date());
			})
			.andWhere((subQuery) => {
				subQuery.whereNull('max_uses').orWhere('max_uses', '>=', this.knex.ref('times_used'));
			})
			.first();

		if (!record) {
			throw new InvalidCredentialsError();
		}

		if (record.share_password && !(await argon2.verify(record.share_password, payload['password']))) {
			throw new InvalidCredentialsError();
		}

		await this.knex('directus_shares')
			.update({ times_used: record.share_times_used + 1 })
			.where('id', record.share_id);

		const tokenPayload: DirectusTokenPayload = {
			app_access: false,
			admin_access: false,
			role: null,
			share: record.share_id,
		};

		const refreshToken = nanoid(64);
		const refreshTokenExpiration = new Date(Date.now() + getMilliseconds(env['REFRESH_TOKEN_TTL'], 0));

		if (options?.session) {
			tokenPayload.session = refreshToken;
		}

		const TTL = env[options?.session ? 'SESSION_COOKIE_TTL' : 'ACCESS_TOKEN_TTL'] as StringValue | number;

		const accessToken = jwt.sign(tokenPayload, getSecret(), {
			expiresIn: TTL,
			issuer: 'directus',
		});

		await this.knex('directus_sessions').insert({
			token: refreshToken,
			expires: refreshTokenExpiration,
			ip: this.accountability?.ip,
			user_agent: this.accountability?.userAgent,
			origin: this.accountability?.origin,
			share: record.share_id,
		});

		await this.knex('directus_sessions').delete().where('expires', '<', new Date());

		return {
			accessToken,
			refreshToken,
			expires: getMilliseconds(TTL),
		};
	}

	/**
	 * Send a link to the given share ID to the given email(s). Note: you can only send a link to a share
	 * if you have read access to that particular share
	 */
	async invite(payload: { emails: string[]; share: PrimaryKey }) {
		if (!this.accountability?.user)
			throw new ForbiddenError({ reason: 'You must be authenticated to send a share invite.' });

		const share = await this.readOne(payload.share, { fields: ['collection'] });

		const usersService = new UsersService({
			knex: this.knex,
			schema: this.schema,
		});

		const mailService = new MailService({ schema: this.schema, accountability: this.accountability });

		const userInfo = await usersService.readOne(this.accountability.user, {
			fields: ['first_name', 'last_name', 'email', 'id'],
		});

		const message = `
Hello!

${userName(userInfo)} has invited you to view an item in ${share['collection']}.

[Open](${new Url(env['PUBLIC_URL'] as string).addPath('admin', 'shared', payload.share).toString()})
`;

		for (const email of payload.emails) {
			mailService
				.send({
					template: {
						name: 'base',
						data: {
							html: md(message),
						},
					},
					to: email,
					subject: `${userName(userInfo)} has shared an item with you`,
				})
				.catch((error) => {
					logger.error(error, `Could not send share notification mail`);
				});
		}
	}
}
