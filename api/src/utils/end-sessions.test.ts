import { createTracker, MockClient, type Tracker } from 'knex-mock-client';
import knex from 'knex';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { endSessions } from './end-sessions.js';

let db: knex.Knex;
let tracker: Tracker;

beforeEach(() => {
	db = knex.default({ client: MockClient });
	tracker = createTracker(db);
});

afterEach(() => {
	tracker.reset();
});

test('ends the named tokens and returns their rows', async () => {
	tracker.on
		.select('directus_sessions')
		.response([{ token: 't1', user: 'u1' }]);

	tracker.on.delete('directus_sessions').response(1);

	const ended = await endSessions(db, { tokens: ['t1', 'gone'] });

	expect(ended).toEqual([{ token: 't1', user: 'u1' }]);
	expect(tracker.history.select[0]!.bindings).toEqual(['t1', 'gone']);
	expect(tracker.history.delete[0]!.bindings).toEqual(['t1']);
});

test('ends every session of the users except the one kept', async () => {
	tracker.on
		.select('directus_sessions')
		.response([{ token: 'other', user: 'u1' }]);

	tracker.on.delete('directus_sessions').response(1);

	await endSessions(db, { users: ['u1', 'u2'], exceptToken: 'mine' });

	expect(tracker.history.select[0]!.sql).toMatch(/"user" in \(\?, \?\) and not "token" = \?/);
	expect(tracker.history.select[0]!.bindings).toEqual(['u1', 'u2', 'mine']);
	expect(tracker.history.delete[0]!.bindings).toEqual(['other']);
});

test('deletes nothing when no row matches', async () => {
	tracker.on.select('directus_sessions').response([]);

	expect(await endSessions(db, { users: ['u1'] })).toEqual([]);
	expect(tracker.history.delete).toHaveLength(0);
});
