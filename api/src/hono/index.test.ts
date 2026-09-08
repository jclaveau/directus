import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { honoDelegated, honoPing } from './index.js';

const env = vi.hoisted(() => ({}) as Record<string, any>);

vi.mock('@directus/env', () => ({ useEnv: () => env }));

beforeEach(() => {
	env['HONO_ROUTES'] = '';
});

describe('honoDelegated', () => {
	it('keeps every route on Express until a mount is named', () => {
		expect(honoDelegated('/server/ping')).toBe(false);
	});

	it('delegates a mount the operator listed', () => {
		env['HONO_ROUTES'] = '/server/ping';

		expect(honoDelegated('/server/ping')).toBe(true);
	});

	it('reads the list as an array, like every other list env var', () => {
		env['HONO_ROUTES'] = ['/server/ping'];

		expect(honoDelegated('/server/ping')).toBe(true);
	});
});

describe('honoPing', () => {
	it('answers the same body Express does, under the same mount', async () => {
		const app = express();

		app.use('/server/ping', await honoPing());

		const server = createServer(app);

		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

		const { port } = server.address() as AddressInfo;

		try {
			const response = await fetch(`http://127.0.0.1:${port}/server/ping`);

			expect(response.status).toBe(200);
			expect(await response.text()).toBe('pong');
		}
		finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});
});
