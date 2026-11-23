import { oneLine } from '@directus/utils';
import { execute, subscribe, type ExecutionArgs } from 'graphql';
import { makeServer, type ServerOptions } from 'graphql-ws';
import { EventEmitter } from 'node:events';
import type { Server as HttpServer } from 'node:http';
import { describe, expect, test, vi } from 'vitest';

vi.mock('../../bus/index.js', () => ({ useBus: () => ({ subscribe: vi.fn() }) }));
vi.mock('../../rate-limiter.js', () => ({ createRateLimiter: vi.fn() }));
vi.mock('../../utils/get-address.js', () => ({ getAddress: vi.fn() }));
vi.mock('./hooks.js', () => ({ registerWebSocketEvents: vi.fn() }));
vi.mock('../authenticate.js', () => ({ authenticateConnection: vi.fn() }));

vi.mock('../../services/graphql/subscription.js', () => {
	return { bindPubSub: vi.fn() };
});

vi.mock('../../utils/get-schema.js', () => {
	return { getSchema: vi.fn(async () => 'schema') };
});

vi.mock('../../services/index.js', () => {
	return {
		GraphQLService: vi.fn(function (options: unknown) {
			return { options, getSchema: async () => 'schema of the client' };
		}),
	};
});

vi.mock('graphql', async (importOriginal) => {
	return {
		...await importOriginal<typeof import('graphql')>(),
		execute: vi.fn(),
		subscribe: vi.fn(),
	};
});

vi.mock('graphql-ws', async (importOriginal) => {
	const actual = await importOriginal<typeof import('graphql-ws')>();

	return { ...actual, makeServer: vi.fn(actual.makeServer) };
});

import {
	readRequestScopedCachePurges,
	recordScopedCachePurged,
} from '../../scoped-cache/purged-record.js';
import { executingService } from '../../services/graphql/schema-cache.js';
import { GraphQLService } from '../../services/index.js';
import { authenticateConnection } from '../authenticate.js';
import type { UpgradeContext } from '../types.js';
import { GraphQLSubscriptionController } from './graphql.js';

describe('GraphQLSubscriptionController', () => {
	test(oneLine`
		the schema of a client is built from its accountability
	`, async () => {
		new GraphQLSubscriptionController(new EventEmitter() as unknown as HttpServer);

		const options = vi.mocked(makeServer).mock.lastCall![0] as ServerOptions;

		const schema = await (options.schema as any)({
			extra: { client: { accountability: { user: 'client' } } },
		});

		expect(schema).toBe('schema of the client');
	});

	test(oneLine`
		an operation runs as a service of the client that sent it
	`, async () => {
		new GraphQLSubscriptionController(new EventEmitter() as unknown as HttpServer);

		const options = vi.mocked(makeServer).mock.lastCall![0] as ServerOptions;

		const context = await (options.context as any)({
			extra: { client: { accountability: { user: 'client' } } },
		});

		expect(context).toEqual({ service: expect.anything() });

		expect(GraphQLService).toHaveBeenLastCalledWith({
			schema: 'schema',
			scope: 'items',
			accountability: { user: 'client' },
		});
	});

	test(oneLine`
		a query and a subscription execute inside the service of their context
	`, () => {
		new GraphQLSubscriptionController(new EventEmitter() as unknown as HttpServer);

		const options = vi.mocked(makeServer).mock.lastCall![0] as ServerOptions;
		const service = { accountability: { user: 'client' } };
		const args = { contextValue: { service } } as unknown as ExecutionArgs;

		vi.mocked(execute)
			.mockImplementation(() => executingService.getStore() as any);

		vi.mocked(subscribe)
			.mockImplementation(() => executingService.getStore() as any);

		expect(options.execute!(args)).toBe(service);
		expect(options.subscribe!(args)).toBe(service);
	});

	test(oneLine`
		a query and a subscription each read a purged list of their own
	`, async () => {
		new GraphQLSubscriptionController(new EventEmitter() as unknown as HttpServer);

		const options = vi.mocked(makeServer).mock.lastCall![0] as ServerOptions;
		const args = { contextValue: { service: {} } } as unknown as ExecutionArgs;

		vi.mocked(execute).mockImplementation(() => {
			recordScopedCachePurged([{ collection: 'articles' }]);

			return readRequestScopedCachePurges() as any;
		});

		vi.mocked(subscribe)
			.mockImplementation(() => readRequestScopedCachePurges() as any);

		await expect(options.execute!(args)).resolves
			.toEqual([{ collection: 'articles' }]);

		await expect(options.subscribe!(args)).resolves.toEqual([]);
	});

	test(oneLine`
		an upgraded connection keeps the IP of its upgrade request until it
		authenticates
	`, async () => {
		const controller = new GraphQLSubscriptionController(
			new EventEmitter() as unknown as HttpServer,
		);

		const ws = {};

		controller.server.handleUpgrade = vi.fn((request, _socket, _head, done) => {
			done(ws as any, request);
		}) as any;

		const emit = vi.spyOn(controller.server, 'emit').mockReturnValue(true);

		await (controller as any).handleHandshakeUpgrade({
			request: {},
			socket: {},
			head: Buffer.alloc(0),
			accountabilityOverrides: { ip: '10.10.10.1' },
		} as unknown as UpgradeContext);

		expect(emit).toHaveBeenCalledWith('connection', ws, {
			accountability: expect.objectContaining({ ip: '10.10.10.1' }),
			expires_at: null,
		});
	});

	test(oneLine`
		a second connection_init in handshake mode closes the socket without
		authenticating its token
	`, async () => {
		const controller = new GraphQLSubscriptionController(
			new EventEmitter() as unknown as HttpServer,
		);

		controller.authentication = { mode: 'handshake', timeout: 10000 };

		vi.mocked(authenticateConnection)
			.mockResolvedValueOnce({
				accountability: { user: 'first' } as any,
				expires_at: 1000,
			})
			.mockResolvedValueOnce({
				accountability: { user: 'second' } as any,
				expires_at: 2000,
			});

		const client = Object.assign(new EventEmitter(), {
			protocol: 'graphql-transport-ws',
			accountability: null,
			expires_at: null,
			send: vi.fn((_data: string, done: () => void) => done()),
			close: vi.fn(),
		});

		(controller as any).bindEvents(client);

		const [onParsedMessage] = client.listeners('parsed-message');

		await onParsedMessage!({
			type: 'connection_init',
			payload: { access_token: 'first-token' },
		});

		await onParsedMessage!({
			type: 'connection_init',
			payload: { access_token: 'second-token' },
		});

		expect(client.close).toHaveBeenCalledExactlyOnceWith(
			4429,
			'Too many initialisation requests',
		);

		expect(authenticateConnection).toHaveBeenCalledTimes(1);
		expect(client.accountability).toEqual({ user: 'first' });
		expect(client.expires_at).toBe(1000);
	});
});
