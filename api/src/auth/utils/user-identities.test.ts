import knex from 'knex';
import { createTracker, MockClient } from 'knex-mock-client';
import { afterEach, expect, test } from 'vitest';
import {
	fetchIdentity,
	fetchPasswordLoginIdentity,
	fetchUserEmail,
	toIdentityKind,
	toProviderName,
} from './user-identities.js';

const db = knex.default({ client: MockClient });
const tracker = createTracker(db);

afterEach(() => {
	tracker.reset();
});

test('the default provider logs in with an email identity', () => {
	expect(toIdentityKind('default')).toBe('email');
});

test('another provider logs in with an identity of its name', () => {
	expect(toIdentityKind('github')).toBe('github');
});

test('an email identity names the default provider', () => {
	expect(toProviderName('email')).toBe('default');
});

test('an SSO identity names its provider', () => {
	expect(toProviderName('github')).toBe('github');
});

test('fetchIdentity matches the kind and the lowered value', async () => {
	tracker.on.select('directus_user_identities').response({
		id: '5b1f6c2a-7e3d-4c8b-a9f0-2d1e3c4b5a69',
		value: 'Ann@Example.com',
	});

	expect(await fetchIdentity(db, 'email', 'Ann@Example.com')).toEqual({
		id: '5b1f6c2a-7e3d-4c8b-a9f0-2d1e3c4b5a69',
		value: 'Ann@Example.com',
	});

	expect(tracker.history.select[0]!.bindings).toEqual([
		'email',
		'ann@example.com',
		1,
	]);
});

test('fetchPasswordLoginIdentity takes a verified or primary email', async () => {
	tracker.on.select('directus_user_identities').response(undefined);

	expect(await fetchPasswordLoginIdentity(db, 'Ann@Example.com')).toBe(undefined);

	expect(tracker.history.select[0]!.sql).toBe(
		'select "identity".* from "directus_user_identities" as "identity"'
		+ ' inner join "directus_users" as "owner"'
		+ ' on "owner"."id" = "identity"."user"'
		+ ' where "identity"."kind" = ? and LOWER("identity"."value") = ?'
		+ ' and ("identity"."verified" = ?'
		+ ' or "identity"."id" = "owner"."primary_identity") limit ?',
	);
});

test('fetchUserEmail returns null for an account without an email', async () => {
	tracker.on.select('directus_user_identities').response(undefined);

	expect(await fetchUserEmail(db, '0d2f8a3e-6d1c-4a5b-9e7f-1c2b3a4d5e6f'))
		.toBe(null);
});

test('fetchUserEmail returns the email shown first', async () => {
	tracker.on.select('directus_user_identities')
		.response({ value: 'ann@example.com' });

	expect(await fetchUserEmail(db, '0d2f8a3e-6d1c-4a5b-9e7f-1c2b3a4d5e6f'))
		.toBe('ann@example.com');
});
