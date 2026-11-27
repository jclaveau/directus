import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { getDatabaseClient } from '../index.js';

const IDENTITIES_TABLE = 'directus_user_identities';
const UNIQUE_INDEX_NAME = 'directus_user_identities_kind_value_unique';
const EMAIL_INDEX_NAME = 'directus_user_identities_user_info_email';
const CONFLICTS_VIEW = 'directus_user_identity_conflicts';
const DEFAULT_PROVIDER = 'default';
const EMAIL_KIND = 'email';
const INSERT_CHUNK_SIZE = 1000;

type LegacyUserRow = {
	id: string;
	email: string | null;
	provider: string | null;
	external_identifier: string | null;
	auth_data: unknown;
};

type IdentityRow = {
	id: string;
	user: string;
	kind: string;
	value: string;
	verified: boolean;
	auth_data: unknown;
};

/**
 * Several identities per account: each email and each SSO identifier is a row
 * of `directus_user_identities`, `directus_users.primary_identity` names the
 * one shown first, and a session names the identity that opened it.
 *
 * An instance holding one address or one identifier twice, case aside, is
 * refused rather than merged: which account keeps it is its owner's call.
 */
export async function up(knex: Knex): Promise<void> {
	const legacyRows: LegacyUserRow[] = await knex
		.select('id', 'email', 'provider', 'external_identifier', 'auth_data')
		.from('directus_users');

	const identityRows = toIdentityRows(legacyRows);

	refuseDuplicateIdentities(identityRows);

	await knex.schema.createTable(IDENTITIES_TABLE, (table) => {
		table.uuid('id').primary()
.notNullable();

		table.uuid('user')
			.notNullable()
			.references('id')
			.inTable('directus_users')
			.onDelete('CASCADE');

		table.string('kind', 128).notNullable();
		table.string('value', 255).notNullable();

		table.boolean('verified').notNullable()
.defaultTo(false);

		table.json('auth_data');
		table.jsonb('user_info');
		table.text('scope');
	});

	// TODO(#610): MariaDB has no expression index, a generated column is needed
	await knex.raw(
		`CREATE UNIQUE INDEX ?? ON ?? (??, lower(??))`,
		[UNIQUE_INDEX_NAME, IDENTITIES_TABLE, 'kind', 'value'],
	);

	await knex.schema.alterTable('directus_users', (table) => {
		table.uuid('primary_identity')
			.references('id')
			.inTable(IDENTITIES_TABLE)
			.onDelete('SET NULL');
	});

	await knex.schema.alterTable('directus_sessions', (table) => {
		table.uuid('identity')
			.references('id')
			.inTable(IDENTITIES_TABLE)
			.onDelete('CASCADE');
	});

	for (let start = 0; start < identityRows.length; start += INSERT_CHUNK_SIZE) {
		await knex(IDENTITIES_TABLE)
			.insert(identityRows.slice(start, start + INSERT_CHUNK_SIZE));
	}

	await setPrimaryIdentities(knex);
	await setSessionIdentities(knex);

	await knex.schema.alterTable('directus_users', (table) => {
		table.dropColumn('email');
		table.dropColumn('provider');
		table.dropColumn('external_identifier');
		table.dropColumn('auth_data');
	});

	await createConflictsView(knex);
}

export async function down(knex: Knex): Promise<void> {
	await dropConflictsView(knex);

	await knex.schema.alterTable('directus_users', (table) => {
		table.string('email', 128).unique();

		table.string('provider', 128).notNullable()
.defaultTo(DEFAULT_PROVIDER);

		table.string('external_identifier').unique();
		table.json('auth_data');
	});

	await restoreLegacyColumns(knex);

	await knex.schema.alterTable('directus_sessions', (table) => {
		table.dropForeign(['identity']);
		table.dropColumn('identity');
	});

	await knex.schema.alterTable('directus_users', (table) => {
		table.dropForeign(['primary_identity']);
		table.dropColumn('primary_identity');
	});

	await knex.schema.dropTable(IDENTITIES_TABLE);
}

function toIdentityRows(legacyRows: LegacyUserRow[]): IdentityRow[] {
	const identityRows: IdentityRow[] = [];

	for (const legacyRow of legacyRows) {
		if (legacyRow.email) {
			identityRows.push({
				id: randomUUID(),
				user: legacyRow.id,
				kind: EMAIL_KIND,
				value: legacyRow.email,
				verified: false,
				auth_data: null,
			});
		}

		const hasProviderIdentity = legacyRow.provider
			&& legacyRow.provider !== DEFAULT_PROVIDER
			&& legacyRow.external_identifier;

		if (hasProviderIdentity) {
			identityRows.push({
				id: randomUUID(),
				user: legacyRow.id,
				kind: legacyRow.provider!,
				value: legacyRow.external_identifier!,
				verified: true,
				auth_data: legacyRow.auth_data ?? null,
			});
		}
	}

	return identityRows;
}

function refuseDuplicateIdentities(identityRows: IdentityRow[]): void {
	const usersByIdentity = new Map<string, string[]>();

	for (const identityRow of identityRows) {
		const identityKey = JSON.stringify([
			identityRow.kind,
			identityRow.value.toLowerCase(),
		]);

		usersByIdentity.set(identityKey, [
			...usersByIdentity.get(identityKey) ?? [],
			identityRow.user,
		]);
	}

	const duplicateList = [...usersByIdentity]
		.filter(([, userIds]) => userIds.length > 1)
		.map(([identityKey, userIds]) => {
			return `${identityKey} (users ${JSON.stringify(userIds)})`;
		});

	if (duplicateList.length > 0) {
		throw new Error(
			`directus_users holds one identity, case aside, on more than one user:`
			+ ` ${duplicateList.join(', ')}. Give each user its own email and`
			+ ` external identifier, then run the migrations again.`,
		);
	}
}

async function setPrimaryIdentities(knex: Knex): Promise<void> {
	for (const kindMatch of ['=', '<>'] as const) {
		const identitySubquery = knex(IDENTITIES_TABLE)
			.select('id')
			.where('user', knex.ref('directus_users.id'))
			.andWhere('kind', kindMatch, EMAIL_KIND)
			.limit(1);

		await knex('directus_users')
			.update({ primary_identity: identitySubquery })
			.whereNull('primary_identity');
	}
}

async function setSessionIdentities(knex: Knex): Promise<void> {
	const identitySubquery = knex({ identity: IDENTITIES_TABLE })
		.select('identity.id')
		.innerJoin({ owner: 'directus_users' }, 'owner.id', 'identity.user')
		.where('identity.user', knex.ref('directus_sessions.user'))
		.andWhere(
			'identity.kind',
			knex.raw(`CASE WHEN ?? = ? THEN ? ELSE ?? END`, [
				'owner.provider',
				DEFAULT_PROVIDER,
				EMAIL_KIND,
				'owner.provider',
			]),
		)
		.limit(1);

	await knex('directus_sessions')
		.update({ identity: identitySubquery })
		.whereNotNull('user');
}

async function restoreLegacyColumns(knex: Knex): Promise<void> {
	type OwnedIdentityRow = IdentityRow & { primary_identity: string | null };

	const identityRows: OwnedIdentityRow[] = await knex({
		identity: IDENTITIES_TABLE,
	})
		.select('identity.*', 'owner.primary_identity')
		.innerJoin({ owner: 'directus_users' }, 'owner.id', 'identity.user')
		.orderBy('identity.user');

	const legacyByUser = new Map<string, Partial<LegacyUserRow>>();

	for (const identityRow of identityRows) {
		const legacyRow = legacyByUser.get(identityRow.user) ?? {};
		const isPrimary = identityRow.id === identityRow.primary_identity;

		if (identityRow.kind === EMAIL_KIND) {
			if (!legacyRow.email || isPrimary) {
				legacyRow.email = identityRow.value;
			}
		}
		else if (!legacyRow.provider || isPrimary) {
			legacyRow.provider = identityRow.kind;
			legacyRow.external_identifier = identityRow.value;
			legacyRow.auth_data = identityRow.auth_data;
		}

		legacyByUser.set(identityRow.user, legacyRow);
	}

	for (const [userId, legacyRow] of legacyByUser) {
		await knex('directus_users').update(legacyRow)
.where('id', userId);
	}
}

/**
 * The SSO identities whose provider sends an address another account holds:
 * the login passes, the address stays in `user_info`, an operator reconciles.
 */
async function createConflictsView(knex: Knex): Promise<void> {
	// TODO(#610): the view and its index on the other databases
	if (getDatabaseClient(knex) !== 'postgres') {
		return;
	}

	await knex.raw(
		`CREATE INDEX ?? ON ?? ((lower(??->>'email')))`,
		[EMAIL_INDEX_NAME, IDENTITIES_TABLE, 'user_info'],
	);

	await knex.raw(
		`CREATE VIEW ?? AS
		SELECT
			sso.id AS identity,
			sso."user" AS "user",
			sso.kind AS kind,
			sso.user_info->>'email' AS email,
			held.id AS held_identity,
			held."user" AS held_user
		FROM ?? AS sso
		INNER JOIN ?? AS held
			ON held.kind = ?
			AND lower(held.value) = lower(sso.user_info->>'email')
			AND held."user" <> sso."user"
		WHERE sso.kind <> ?`,
		[CONFLICTS_VIEW, IDENTITIES_TABLE, IDENTITIES_TABLE, EMAIL_KIND, EMAIL_KIND],
	);
}

async function dropConflictsView(knex: Knex): Promise<void> {
	if (getDatabaseClient(knex) !== 'postgres') {
		return;
	}

	await knex.raw(`DROP VIEW IF EXISTS ??`, [CONFLICTS_VIEW]);
	await knex.raw(`DROP INDEX IF EXISTS ??`, [EMAIL_INDEX_NAME]);
}
