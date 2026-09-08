import express from 'express';
import { register } from 'prom-client';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	instrumentRequestTiming,
	requestTiming,
	requestTimingEnabled,
} from './request-timing.js';

const env = vi.hoisted(() => ({}) as Record<string, any>);

vi.mock('@directus/env', () => ({ useEnv: () => env }));

beforeEach(() => {
	env['REQUEST_TIMING_ENABLED'] = true;
	env['REQUEST_TIMING_HEADER'] = 'Server-Timing-Breakdown';
});

const HEADER = 'server-timing-breakdown';

const call = async (
	build: (app: express.Express) => void,
	path = '/items/articles',
) => {
	const app = express();

	instrumentRequestTiming(app);
	app.use(requestTiming);
	build(app);

	const server = createServer(app);

	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

	const { port } = server.address() as AddressInfo;

	try {
		const response = await fetch(`http://127.0.0.1:${port}${path}`);

		return { response, body: await response.text() };
	}
	finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
};

const breakdown = (response: Response): Record<string, number> => {
	return Object.fromEntries(
		(response.headers.get(HEADER) ?? '')
			.split('; ')
			.map((pair) => pair.split('='))
			.map(([name, ms]) => [name, Number(ms)]),
	);
};

describe('requestTimingEnabled', () => {
	it('is off unless the env var says otherwise', () => {
		env['REQUEST_TIMING_ENABLED'] = false;

		expect(requestTimingEnabled()).toBe(false);
	});

	it('reads a string env value like every other boolean flag', () => {
		env['REQUEST_TIMING_ENABLED'] = 'true';

		expect(requestTimingEnabled()).toBe(true);
	});
});

describe('requestTiming', () => {
	it('reports nothing at all when disabled', async () => {
		env['REQUEST_TIMING_ENABLED'] = false;

		const { response } = await call((app) => {
			app.get('/items/articles', (_req, res) => {
				res.json({ ok: true });
			});
		});

		expect(response.headers.get(HEADER)).toBeNull();
	});

	it('keeps the breakdown out of the response without a header name', async () => {
		env['REQUEST_TIMING_HEADER'] = undefined;

		const { response } = await call((app) => {
			app.get('/items/articles', (_req, res) => {
				res.json({ ok: true });
			});
		});

		expect(response.headers.get(HEADER)).toBeNull();
	});

	it('splits the total into framework, middleware and handler', async () => {
		const { response } = await call((app) => {
			app.use(async function slowMiddleware(_req, _res, next) {
				await sleep(25);
				next();
			});

			app.get('/items/articles', async (_req, res) => {
				await sleep(50);
				res.json({ ok: true });
			});
		});

		const phases = breakdown(response);

		expect(phases['middleware']).toBeGreaterThanOrEqual(20);
		expect(phases['handler']).toBeGreaterThanOrEqual(45);
		expect(phases['total']).toBeGreaterThanOrEqual(70);

		// Whatever is left once our own spans are subtracted is Express's own
		// matching and dispatch — the number #458 turns on.
		expect(phases['framework']).toBeCloseTo(
			phases['total']! - phases['middleware']! - phases['handler']!,
			2,
		);
	});

	it('names each layer by its mount path, or else by its function', async () => {
		const { response } = await call((app) => {
			app.use(function tagged(_req, _res, next) {
				next();
			});

			app.use('/items', (_req, _res, next) => {
				next();
			});

			app.get('/items/articles', (_req, res) => {
				res.json({ ok: true });
			});
		});

		expect(response.headers.get(HEADER)).toContain('tagged=');
		expect(response.headers.get(HEADER)).toContain('/items=');
		expect(response.headers.get(HEADER)).toContain('/items/articles=');
	});

	it('leaves the error chain intact by not wrapping it', async () => {
		const { response, body } = await call((app) => {
			app.get('/items/articles', () => {
				throw new Error('nope');
			});

			app.use((_err: unknown, _req: any, res: any, _next: any) => {
				res.status(418).json({ handled: true });
			});
		});

		expect(response.status).toBe(418);
		expect(JSON.parse(body)).toEqual({ handled: true });
	});

	it('charges a thrown layer only up to the layer that took over', async () => {
		const { response } = await call((app) => {
			app.get('/items/articles', () => {
				throw new Error('nope');
			});

			app.use(async (_err: unknown, _req: any, res: any, _next: any) => {
				await sleep(30);
				res.status(500).end();
			});
		});

		const phases = breakdown(response);

		// The throwing layer never called `next()`; without the bound it would
		// swallow the error handler's 30ms as its own.
		expect(phases['/items/articles']).toBeLessThan(20);
	});

	it('labels a mounted group by its mount, not by the stripped path', async () => {
		const router = express.Router();

		router.get('/articles', (_req, res) => {
			res.json({ ok: true });
		});

		await call((app) => app.use('/items', router));

		const metric = register.getSingleMetric('directus_request_timing_phase_ms');
		const { values } = await metric!.get();

		expect(values.map((value) => value.labels['route'])).toContain('/items');
	});

	it('leaves the settings getter alone', () => {
		const app = express();

		instrumentRequestTiming(app);
		app.set('trust proxy', 'loopback');

		expect(app.get('trust proxy')).toBe('loopback');
	});

	it('mounts nothing extra when the probe is off', () => {
		env['REQUEST_TIMING_ENABLED'] = false;

		const app = express();
		const original = app.use;

		instrumentRequestTiming(app);

		expect(app.use).toBe(original);
	});
});
