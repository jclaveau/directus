import { Action } from '@directus/constants';
import knex from 'knex';
import { createTracker, MockClient, type Tracker } from 'knex-mock-client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
	endSessions,
	hashSessionToken,
	SESSION_ENDED_CHANNEL,
} from './end-sessions.js';

const publish = vi.hoisted(() => vi.fn());
vi.mock('../bus/index.js', () => ({ useBus: () => ({ publish }) }));

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
	db = knex.default({ client: MockClient });
	tracker = createTracker(db);
});

afterEach(() => {
	tracker.reset();
	publish.mockReset();
});

test('ends the named tokens, returns their rows and tells the sockets', async () => {
	tracker.on.select('directus_sessions').response([row]);
	tracker.on.delete('directus_sessions').response(1);

	const ended = await endSessions(db, { tokens: ['t1', 'gone'] });

	expect(ended).toEqual([row]);
	expect(tracker.history.select[0]!.bindings).toEqual(['t1', 'gone']);
	expect(tracker.history.delete[0]!.bindings).toEqual(['t1']);
	expect(tracker.history.insert).toHaveLength(0);

	// Hashed: the bus is pub/sub, and only the ended session is named.
	expect(publish).toHaveBeenCalledWith(SESSION_ENDED_CHANNEL, {
		tokens: [hashSessionToken('t1')],
		users: [],
		exceptTokens: [],
	});
});

test('ends every session of the users and every impersonation as them', async () => {
	tracker.on.select('directus_sessions').response([{ ...row, token: 'other' }]);
	tracker.on.delete('directus_sessions').response(1);

	await endSessions(db, { users: ['u1', 'u2'], exceptToken: 'mine' });

	expect(tracker.history.select[0]!.sql).toMatch(
		/\("user" in \(\?, \?\) or "impersonator" in \(\?, \?\)\) and not "token" = \?/,
	);

	expect(tracker.history.select[0]!.bindings)
		.toEqual(['u1', 'u2', 'u1', 'u2', 'mine']);

	expect(tracker.history.delete[0]!.bindings).toEqual(['other']);

	// Sockets have no row to match on: the users name them, the kept session
	// is spared by its hash.
	expect(publish).toHaveBeenCalledWith(SESSION_ENDED_CHANNEL, {
		tokens: [hashSessionToken('other')],
		users: ['u1', 'u2'],
		exceptTokens: [hashSessionToken('mine')],
	});
});

test('writes the trail for every impersonated row it ends', async () => {
	tracker.on.select('directus_sessions').response([
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

	tracker.on.delete('directus_sessions').response(2);
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

test('deletes nothing and tells nobody when no row matches', async () => {
	tracker.on.select('directus_sessions').response([]);

	expect(await endSessions(db, { tokens: ['gone'] })).toEqual([]);
	expect(tracker.history.delete).toHaveLength(0);
	expect(publish).not.toHaveBeenCalled();
});

test('still names the users to the sockets when they hold no row', async () => {
	tracker.on.select('directus_sessions').response([]);

	await endSessions(db, { users: ['u1'] });

	expect(publish).toHaveBeenCalledWith(SESSION_ENDED_CHANNEL, {
		tokens: [],
		users: ['u1'],
		exceptTokens: [],
	});
});
