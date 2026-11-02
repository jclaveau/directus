import { ForbiddenError } from '@directus/errors';
import { oneLine } from '@directus/utils';
import { EventEmitter } from 'node:events';
import type { Server as HttpServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, test, vi } from 'vitest';
import emitter from '../../emitter.js';
import { WebSocketController } from './rest.js';

vi.mock('../../bus/index.js', () => ({ useBus: () => ({ subscribe: vi.fn() }) }));
vi.mock('../../rate-limiter.js', () => ({ createRateLimiter: vi.fn() }));
vi.mock('../../utils/get-address.js', () => ({ getAddress: vi.fn() }));
vi.mock('./hooks.js', () => ({ registerWebSocketEvents: vi.fn() }));
vi.mock('../../services/index.js', () => ({}));
vi.mock('../../database/index.js', () => ({ default: vi.fn() }));

vi.mock('@directus/env', async (importOriginal) => {
	const { useEnv } = await importOriginal<typeof import('@directus/env')>();

	return {
		useEnv: () => {
			return {
				...useEnv(),
				QUERY_AUDIT_HEADER: 'X-Query-Audit',
				QUERY_AUDIT_LEVEL: 'counts',
				QUERY_AUDIT_HEADER_MAX_SIZE: '8kb',
			};
		},
	};
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('a parsed message', () => {
	test('emits the websocket.message action once its filter passes', async () => {
		const emitAction = vi.spyOn(emitter, 'emitAction').mockReturnValue();

		const send = vi.fn();
		const ws = Object.assign(new EventEmitter(), { send });

		new WebSocketController(
			new EventEmitter() as unknown as HttpServer,
		).server.emit('connection', ws, {
			accountability: null,
			expires_at: null,
		});

		await ws.listeners('parsed-message')[0]!({ type: 'items', uid: 1 });

		expect(emitAction).toHaveBeenLastCalledWith('websocket.message', {
			message: { type: 'items', uid: 1 },
			client: ws,
		});

		expect(send).not.toHaveBeenCalled();
	});

	test(oneLine`
		replies a server error and emits no action when its filter throws
	`, async () => {
		vi.spyOn(emitter, 'emitFilter').mockRejectedValue(new ForbiddenError());
		const emitAction = vi.spyOn(emitter, 'emitAction').mockReturnValue();

		const send = vi.fn();
		const ws = Object.assign(new EventEmitter(), { send });

		new WebSocketController(
			new EventEmitter() as unknown as HttpServer,
		).server.emit('connection', ws, {
			accountability: null,
			expires_at: null,
		});

		await ws.listeners('parsed-message')[0]!({ type: 'items', uid: 1 });

		expect(send.mock.calls).toEqual([
			[
				'{"type":"server","status":"error","error":{"code":"FORBIDDEN",'
				+ '"message":"You don\'t have permission to access this."}}',
			],
		]);

		expect(emitAction.mock.calls).toEqual([
			['websocket.connect', { client: ws }],
		]);
	});

	test('carries its query audit in its reply', async () => {
		vi.spyOn(performance, 'now').mockReturnValue(0);

		const send = vi.fn();
		const ws = Object.assign(new EventEmitter(), { send });

		new WebSocketController(
			new EventEmitter() as unknown as HttpServer,
		).server.emit('connection', ws, {
			accountability: null,
			expires_at: null,
		});

		vi.spyOn(emitter, 'emitAction').mockImplementation(() => {
			ws.send('{"type":"items","data":[],"uid":1}');
		});

		await ws.listeners('parsed-message')[0]!({ type: 'items', uid: 1 });

		expect(send.mock.calls).toEqual([
			[
				'{"type":"items","data":[],"uid":1,"query_audit":'
				+ '{"ms":0,"db":0,"wait":0,"maxPoolConnections":0,'
				+ '"statements":[]}}',
			],
		]);
	});
});
