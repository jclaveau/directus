import { EventEmitter } from 'node:events';
import type { Server as HttpServer } from 'node:http';
import { afterEach, describe, expect, test, vi } from 'vitest';
import emitter from '../../emitter.js';
import {
	readRequestScopedCachePurges,
	recordScopedCachePurged,
} from '../../scoped-cache/purged-record.js';
import { LogsController } from './logs.js';

vi.mock('../../bus/index.js', () => ({ useBus: () => ({ subscribe: vi.fn() }) }));
vi.mock('../../rate-limiter.js', () => ({ createRateLimiter: vi.fn() }));
vi.mock('../../utils/get-address.js', () => ({ getAddress: vi.fn() }));
vi.mock('../../services/index.js', () => ({}));
vi.mock('../../database/index.js', () => ({ default: vi.fn() }));

afterEach(() => {
	vi.restoreAllMocks();
});

describe('a parsed logs message', () => {
	test('names what its handlers purged, as a request does', async () => {
		const ws = Object.assign(new EventEmitter(), { send: vi.fn() });

		new LogsController(
			new EventEmitter() as unknown as HttpServer,
		).server.emit('connection', ws, {
			accountability: null,
			expires_at: null,
		});

		const readings: Promise<unknown>[] = [];

		vi.spyOn(emitter, 'emitAction').mockImplementation(async (event) => {
			if (event === 'websocket.logs') {
				recordScopedCachePurged([{ collection: 'articles' }]);
				readings.push(readRequestScopedCachePurges());
			}
		});

		await ws.listeners('parsed-message')[0]!({ type: 'subscribe', uid: 1 });
		await ws.listeners('parsed-message')[0]!({ type: 'subscribe', uid: 2 });

		await expect(Promise.all(readings)).resolves.toEqual([
			[{ collection: 'articles' }],
			[{ collection: 'articles' }],
		]);
	});
});
