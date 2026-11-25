import { Action } from '@directus/constants';
import knex from 'knex';
import { createTracker, MockClient, type Tracker } from 'knex-mock-client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { getDatabaseClient } from '../database/index.js';
import {
	endSessions,
	hashSessionToken,
	SESSION_ENDED_CHANNEL,
} from './end-sessions.js';

const publish = vi.hoisted(() => vi.fn());
vi.mock('../bus/index.js', () => ({ useBus: () => ({ publish }) }));

vi.mock('../database/index.js', () => {
	return { getDatabaseClient: vi.fn().mockReturnValue('postgres') };
});

let db: knex.Knex;
let tracker: Tracker;

const row = {
	token: 't1',
	user: 'u1',
	impersonator: null,
	ip: null,
	user_agent: null,
	origin: null,
};

beforeEach(() => {
	db = knex.default({ client: MockClient, dialect: 'pg' });
	tracker = createTracker(db);
});

afterEach(() => {
	tracker.reset();
	publish.mockReset();
});

test('ends the named tokens, returns their rows and tells the sockets', async () => {
	tracker.on.delete('directus_sessions').response([row]);

	const ended = await endSessions(db, { tokens: ['t1', 'gone'] });

	expect(ended).toEqual([row]);

	// One statement: the rows come back from the delete itself.
	expect(tracker.history.all).toHaveLength(1);

	expect(tracker.history.delete[0]!.sql).toBe(
		'delete from "directus_sessions" where ("token" in ($1, $2)'
		+ ' or "impersonator_session" in ($3, $4))'
		+ ' returning "token", "user", "impersonator", "ip", "user_agent", "origin"',
	);

	expect(tracker.history.delete[0]!.bindings)
		.toEqual(['t1', 'gone', 't1', 'gone']);

	// Hashed: the bus is pub/sub, and only the ended session is named.
	expect(publish).toHaveBeenCalledWith(SESSION_ENDED_CHANNEL, {
		tokens: [hashSessionToken('t1')],
		users: [],
		exceptTokens: [],
	});
});

test('ends the impersonations opened from the named sessions too', async () => {
	// The admin's own row and the session-mode impersonation it opened
	tracker.on.delete('directus_sessions').response([
		{ ...row, token: 'admin-session', user: 'admin' },
		{ ...row, token: 'imp', user: 'u1', impersonator: 'admin' },
	]);

	tracker.on.insert('directus_activity').response([]);

	const ended = await endSessions(db, { tokens: ['admin-session'] });

	expect(tracker.history.delete[0]!.bindings)
		.toEqual(['admin-session', 'admin-session']);

	expect(ended).toEqual([
		{ ...row, token: 'admin-session', user: 'admin' },
		{ ...row, token: 'imp', user: 'u1', impersonator: 'admin' },
	]);

	// The trail and the kick name the impersonation, not only the session
	expect(tracker.history.insert[0]!.bindings)
		.toEqual(expect.arrayContaining([Action.IMPERSONATE_END, 'admin', 'u1']));

	expect(publish).toHaveBeenCalledWith(SESSION_ENDED_CHANNEL, {
		tokens: [hashSessionToken('admin-session'), hashSessionToken('imp')],
		users: [],
		exceptTokens: [],
	});
});

test('ends every session of the users and every impersonation as them', async () => {
	tracker.on.delete('directus_sessions').response([{ ...row, token: 'other' }]);

	await endSessions(db, { users: ['u1', 'u2'], exceptToken: 'mine' });

	expect(tracker.history.delete[0]!.sql).toBe(
		'delete from "directus_sessions" where ("user" in ($1, $2)'
		+ ' or "impersonator" in ($3, $4)) and not "token" = $5'
		+ ' returning "token", "user", "impersonator", "ip", "user_agent", "origin"',
	);

	expect(tracker.history.delete[0]!.bindings)
		.toEqual(['u1', 'u2', 'u1', 'u2', 'mine']);

	// Sockets have no row to match on: the users name them, the kept session
	// is spared by its hash.
	expect(publish).toHaveBeenCalledWith(SESSION_ENDED_CHANNEL, {
		tokens: [hashSessionToken('other')],
		users: ['u1', 'u2'],
		exceptTokens: [hashSessionToken('mine')],
	});
});

test('writes the trail for every impersonated row it ends', async () => {
	tracker.on.delete('directus_sessions').response([
		row,
		{
			token: 'imp',
			user: 'u1',
			impersonator: 'admin',
			ip: '10.0.0.1',
			user_agent: 'curl',
			origin: null,
		},
	]);

	tracker.on.insert('directus_activity').response([]);

	await endSessions(db, { tokens: ['t1', 'imp'] });

	expect(tracker.history.insert).toHaveLength(1);

	// The admin is the actor of the end, the target its subject, and the
	// request fields are the impersonation's own.
	expect(tracker.history.insert[0]!.bindings).toEqual(
		expect.arrayContaining([
			Action.IMPERSONATE_END,
			'admin',
			'u1',
			'directus_users',
			'10.0.0.1',
			'curl',
		]),
	);
});

test('writes no trail and tells nobody when no row matches', async () => {
	tracker.on.delete('directus_sessions').response([]);

	expect(await endSessions(db, { tokens: ['gone'] })).toEqual([]);
	expect(tracker.history.insert).toHaveLength(0);
	expect(publish).not.toHaveBeenCalled();
});

test('still names the users to the sockets when they hold no row', async () => {
	tracker.on.delete('directus_sessions').response([]);

	await endSessions(db, { users: ['u1'] });

	expect(publish).toHaveBeenCalledWith(SESSION_ENDED_CHANNEL, {
		tokens: [],
		users: ['u1'],
		exceptTokens: [],
	});
});

test('reads the rows first on mysql, where knex drops returning', async () => {
	vi.mocked(getDatabaseClient).mockReturnValueOnce('mysql');
	tracker.on.select('directus_sessions').response([row]);
	tracker.on.delete('directus_sessions').response(1);

	expect(await endSessions(db, { tokens: ['t1', 'gone'] })).toEqual([row]);

	expect(tracker.history.select[0]!.sql).toBe(
		'select "token", "user", "impersonator", "ip", "user_agent", "origin"'
		+ ' from "directus_sessions" where ("token" in ($1, $2)'
		+ ' or "impersonator_session" in ($3, $4))',
	);

	expect(tracker.history.delete[0]!.sql)
		.toBe('delete from "directus_sessions" where "token" in ($1)');

	expect(tracker.history.delete[0]!.bindings).toEqual(['t1']);
});

test('deletes nothing on mysql when no row matches', async () => {
	vi.mocked(getDatabaseClient).mockReturnValueOnce('mysql');
	tracker.on.select('directus_sessions').response([]);

	expect(await endSessions(db, { tokens: ['gone'] })).toEqual([]);
	expect(tracker.history.delete).toHaveLength(0);
});
