import { createTerminus } from '@godaddy/terminus';
import { afterEach, describe, expect, test, vi } from 'vitest';

const { mockEnv } = vi.hoisted(() => {
	return { mockEnv: {} as Record<string, unknown> };
});

vi.mock('@directus/env', () => ({ useEnv: () => mockEnv }));
vi.mock('@godaddy/terminus', () => ({ createTerminus: vi.fn() }));
vi.mock('./app.js', () => ({ default: vi.fn(async () => vi.fn()) }));
vi.mock('./database/index.js', () => ({ default: vi.fn() }));
vi.mock('./emitter.js', () => ({ default: { emitAction: vi.fn() } }));

vi.mock('./logger/index.js', () => {
	return {
		useLogger: () => {
			return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		},
	};
});

vi.mock('./outstanding-migrations.js', () => {
	return {
		holdHealthForOutstandingMigrations: vi.fn(),
		stopWatchingOutstandingMigrations: vi.fn(),
		watchOutstandingMigrations: vi.fn(),
	};
});

vi.mock('./processes/lib/report-in-flight.js', () => {
	return { reportInFlightRequests: vi.fn() };
});

vi.mock('./websocket/controllers/index.js', () => {
	return {
		createLogsController: vi.fn(),
		createSubscriptionController: vi.fn(),
		createWebSocketController: vi.fn(),
		getLogsController: vi.fn(),
		getSubscriptionController: vi.fn(),
		getWebSocketController: vi.fn(),
	};
});

vi.mock('./websocket/handlers/index.js', () => {
	return { startWebSocketHandlers: vi.fn() };
});

import { createServer } from './server.js';

afterEach(() => {
	vi.clearAllMocks();
});

describe('createServer shutdown timeout', () => {
	test('a SERVER_SHUTDOWN_TIMEOUT of 5000 waits 5000 ms', async () => {
		mockEnv['SERVER_SHUTDOWN_TIMEOUT'] = 5000;

		await createServer();

		expect(createTerminus).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ timeout: 5000 }),
		);
	});

	test('a SERVER_SHUTDOWN_TIMEOUT of -1 waits the default 1000 ms', async () => {
		mockEnv['SERVER_SHUTDOWN_TIMEOUT'] = -1;

		await createServer();

		expect(createTerminus).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ timeout: 1000 }),
		);
	});
});
