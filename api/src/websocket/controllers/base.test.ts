import knex from 'knex';
import { createTracker, MockClient, type Tracker } from 'knex-mock-client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import getDatabase from '../../database/index.js';
import {
	hashSessionToken,
	SESSION_ENDED_CHANNEL,
} from '../../utils/end-sessions.js';
import type { WebSocketClient } from '../types.js';
import SocketController from './base.js';

vi.mock('@directus/env', () => {
	return {
		useEnv: () => {
			return {
				WEBSOCKETS_REST_PATH: '/websocket',
				WEBSOCKETS_REST_AUTH: 'handshake',
				WEBSOCKETS_REST_AUTH_TIMEOUT: 10,
				RATE_LIMITER_ENABLED: false,
			};
		},
	};
});

const logger = vi.hoisted(() => ({ debug: vi.fn(), trace: vi.fn(), warn: vi.fn() }));
vi.mock('../../logger/index.js', () => ({ useLogger: () => logger }));

vi.mock('../../database/index.js');

// Reached only on an upgrade; its import chain drags the services in.
vi.mock('../authenticate.js', () => {
	return { authenticateConnection: vi.fn(), authenticationSuccess: vi.fn() };
});

const bus = vi.hoisted(() => ({ subscribe: vi.fn(), publish: vi.fn() }));
vi.mock('../../bus/index.js', () => ({ useBus: () => bus }));

class TestController extends SocketController {}

function client(accountability: Record<string, unknown> | null): WebSocketClient {
	return {
		uid: 'c',
		accountability,
		expires_at: null,
		auth_timer: null,
		send: vi.fn(),
		close: vi.fn(),
	} as unknown as WebSocketClient;
}

let controller: TestController;
let db: knex.Knex;
let tracker: Tracker;

beforeEach(() => {
	// Only the controller's own timers: knex settles its queries on the rest.
	vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
	db = knex.default({ client: MockClient });
	tracker = createTracker(db);
	vi.mocked(getDatabase).mockReturnValue(db);
	controller = new TestController({ on: vi.fn() } as never, 'WEBSOCKETS_REST');
});

afterEach(() => {
	controller.terminate();
	vi.useRealTimers();
	tracker.reset();
	bus.subscribe.mockReset();
});

function ended() {
	// The controller subscribed once, in its constructor.
	const [channel, listener] = bus.subscribe.mock.calls[0]!;

	expect(channel).toBe(SESSION_ENDED_CHANNEL);

	return listener as (event: unknown) => void;
}

test('closes the socket whose session ended, with SESSION_ENDED', () => {
	const mine = client({ user: 'jane', session: 'jane-session' });
	const other = client({ user: 'jane', session: 'jane-other-session' });
	controller.clients.add(mine);
	controller.clients.add(other);

	ended()({
		tokens: [hashSessionToken('jane-session')],
		users: [],
		exceptTokens: [],
	});

	expect(mine.close).toHaveBeenCalledOnce();
	expect(mine.accountability).toBeNull();

	expect(mine.send)
		.toHaveBeenCalledWith(expect.stringContaining('"SESSION_ENDED"'));

	expect(other.close).not.toHaveBeenCalled();
	expect(other.accountability).not.toBeNull();
});

test("a user's kick closes their sockets and those run as them, not others", () => {
	const jane = client({ user: 'jane', session: 'jane-session' });
	const janeBearer = client({ user: 'jane' });
	const adminAsJane = client({ user: 'jane', impersonator: 'admin' });
	const adminAsBob = client({ user: 'bob', impersonator: 'admin', session: 'x' });
	const bob = client({ user: 'bob', session: 'bob-session' });
	const anonymous = client(null);

	for (const each of [jane, janeBearer, adminAsJane, adminAsBob, bob, anonymous]) {
		controller.clients.add(each);
	}

	ended()({ tokens: [], users: ['jane'], exceptTokens: [] });

	expect(jane.close).toHaveBeenCalledOnce();
	expect(janeBearer.close).toHaveBeenCalledOnce();
	expect(adminAsJane.close).toHaveBeenCalledOnce();
	expect(adminAsBob.close).not.toHaveBeenCalled();
	expect(bob.close).not.toHaveBeenCalled();
	expect(anonymous.close).not.toHaveBeenCalled();
});

test("the admin's kick closes every socket they run as anyone", () => {
	const admin = client({ user: 'admin', session: 'admin-session' });
	const adminAsJane = client({ user: 'jane', impersonator: 'admin', session: 'i' });
	const jane = client({ user: 'jane', session: 'jane-session' });

	for (const each of [admin, adminAsJane, jane]) {
		controller.clients.add(each);
	}

	ended()({ tokens: [], users: ['admin'], exceptTokens: [] });

	expect(admin.close).toHaveBeenCalledOnce();
	expect(adminAsJane.close).toHaveBeenCalledOnce();
	// The target's own socket carries no impersonator: untouched.
	expect(jane.close).not.toHaveBeenCalled();
});

test('spares the session that did the ending', () => {
	const changing = client({ user: 'jane', session: 'here' });
	const elsewhere = client({ user: 'jane', session: 'there' });
	controller.clients.add(changing);
	controller.clients.add(elsewhere);

	ended()({ tokens: [], users: ['jane'], exceptTokens: [hashSessionToken('here')] });

	expect(changing.close).not.toHaveBeenCalled();
	expect(elsewhere.close).toHaveBeenCalledOnce();
});

test('the periodic check ends a session socket whose row is gone', async () => {
	const alive = client({ user: 'jane', session: 'alive' });
	const orphan = client({ user: 'jane', session: 'orphan' });
	const bearer = client({ user: 'jane' });

	for (const each of [alive, orphan, bearer]) {
		controller.clients.add(each);
	}

	tracker.on.select('directus_sessions').response([{ token: 'alive' }]);

	await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
	// The row check runs off the tick; let its query settle on real time.
	await new Promise((resolve) => setTimeout(resolve, 0));

	expect(logger.warn).not.toHaveBeenCalled();
	expect(tracker.history.select[0]!.bindings).toEqual(['alive', 'orphan']);
	expect(orphan.close).toHaveBeenCalledOnce();

	expect(orphan.send)
		.toHaveBeenCalledWith(expect.stringContaining('"SESSION_ENDED"'));

	expect(alive.close).not.toHaveBeenCalled();
	expect(bearer.close).not.toHaveBeenCalled();
});

test('the periodic check asks nothing when no socket holds a session', async () => {
	controller.clients.add(client({ user: 'jane' }));

	await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

	expect(tracker.history.select).toHaveLength(0);
});
