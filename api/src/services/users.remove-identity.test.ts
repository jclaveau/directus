import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import knex from 'knex';
import { MockClient, createTracker } from 'knex-mock-client';
import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import { ItemsService, UsersService } from './index.js';

vi.mock('../../src/database/index', () => {
	return {
		default: vi.fn(),
		getDatabaseForAccountability: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

vi.mock('@directus/env', () => {
	return { useEnv: vi.fn().mockReturnValue({ AUTH_PROVIDERS: [] }) };
});

const schema = new SchemaBuilder()
	.collection('directus_users', (c) => {
		c.field('id').uuid()
			.primary();

		c.field('primary_identity').uuid();
	})
	.collection('directus_user_identities', (c) => {
		c.field('id').uuid()
			.primary();

		c.field('user').uuid();
		c.field('kind').string();
		c.field('verified').boolean();
	})
	.build();

// Its own file: knex locks rows only on a dialect, and a pg mock client
// turns every mock client of the file to pg
const pgDatabase = knex.default({ client: MockClient, dialect: 'pg' });
const tracker = createTracker(pgDatabase);
const service = new UsersService({ knex: pgDatabase, schema });

afterEach(() => {
	tracker.reset();
});

test('refuses an identity of another account', async () => {
	tracker.on.select('directus_user_identities').response([
		{
			id: 'identity-email',
			kind: 'email',
			verified: true,
		},
	]);

	await expect(service.removeIdentity('user-id-1', 'identity-other'))
		.rejects.toEqual(new ForbiddenError({
			reason: `The identity "identity-other" isn't one of the account's`,
		}));
});

test('refuses the account\'s last identity', async () => {
	tracker.on.select('directus_user_identities').response([
		{
			id: 'identity-email',
			kind: 'email',
			verified: true,
		},
	]);

	await expect(service.removeIdentity('user-id-1', 'identity-email'))
		.rejects.toEqual(new InvalidPayloadError({
			reason: `The identity "identity-email" is the account's last identity`,
		}));
});

test('moves the primary to a verified email, then deletes', async () => {
	tracker.on.select('directus_user_identities').response([
		{
			id: 'identity-github',
			kind: 'github',
			verified: true,
		},
		{
			id: 'identity-unverified',
			kind: 'email',
			verified: false,
		},
		{
			id: 'identity-verified',
			kind: 'email',
			verified: true,
		},
		{
			id: 'identity-removed',
			kind: 'email',
			verified: true,
		},
	]);

	tracker.on.update('directus_users').response(1);

	const deleteOne = vi.spyOn(ItemsService.prototype, 'deleteOne')
		.mockResolvedValue('identity-removed');

	onTestFinished(() => {
		deleteOne.mockRestore();
	});

	await service.removeIdentity('user-id-1', 'identity-removed');

	expect(tracker.history.update[0]!.bindings).toEqual([
		'identity-verified',
		'user-id-1',
		'identity-removed',
	]);

	expect(deleteOne).toHaveBeenCalledWith('identity-removed');
});
