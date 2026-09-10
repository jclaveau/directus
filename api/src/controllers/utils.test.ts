import { beforeEach, describe, expect, test, vi } from 'vitest';

const getCacheGroupLatencies = vi.fn();
const readAutoscaleConfig = vi.fn();
const updateAutoscaleConfig = vi.fn();
const updateSupervisorConfig = vi.fn();
const clearAutoscaleConfig = vi.fn();
const startAutoscaleReload = vi.fn();
const readAutoscaleDrill = vi.fn();
const startAutoscaleDrill = vi.fn();
const stopAutoscaleDrill = vi.fn();

vi.mock('../services/utils.js', () => {
	return {
		UtilsService: vi.fn(() => {
			return {
				getCacheGroupLatencies,
				readAutoscaleConfig,
				updateAutoscaleConfig,
				updateSupervisorConfig,
				clearAutoscaleConfig,
				startAutoscaleReload,
				readAutoscaleDrill,
				startAutoscaleDrill,
				stopAutoscaleDrill,
			};
		}),
	};
});

// Both gates are read at import time: the autoscale routes exist only where Redis
// can carry the shared config and the bus can reach the pool.
vi.mock('../redis/index.js', async (importOriginal) => {
	return {
		...await importOriginal<object>(),
		redisConfigAvailable: () => true,
	};
});

vi.mock('../autoscale/lib/drill.js', () => ({ autoscaleDrillEnabled: () => true }));

vi.mock('../services/import-export.js', () => {
	return { ExportService: vi.fn(), ImportService: vi.fn() };
});

vi.mock('../services/revisions.js', () => ({ RevisionsService: vi.fn() }));
vi.mock('../middleware/respond.js', () => ({ respond: vi.fn() }));
vi.mock('../middleware/collection-exists.js', () => ({ default: vi.fn() }));

const { default: router } = await import('./utils.js');

// router.get(path, asyncHandler(fn), respond) registers one Route layer whose own
// stack holds [handler, respond]; drive the bare handler, as server.test.ts does.
function handlerFor(path: string, method = 'get') {
	const layer = router.stack.find((entry: any) => {
		return entry.route?.path === path
			&& entry.route.stack.some((handler: any) => handler.method === method);
	});

	return layer!.route!.stack[0]!.handle;
}

describe('utils controller /cache/latencies', () => {
	beforeEach(() => vi.clearAllMocks());

	test('never caches the listing and hands the window down unread', async () => {
		const rows = [{ path: '/items/a', method: null, query: null }];
		getCacheGroupLatencies.mockResolvedValueOnce(rows);

		const req = {
			accountability: null,
			schema: {},
			query: { window: '12h' },
		} as any;

		const res = { locals: {} } as any;
		const next = vi.fn();

		await handlerFor('/cache/latencies')(req, res, next);

		// The latencies must reflect live state, so the response itself is never
		// served from the cache it reports on.
		expect(res.locals['cache']).toBe(false);
		// Unread on purpose: `UtilsService` parses it, so this route and the MCP
		// tool beside it cannot come to disagree about what a duration means.
		expect(getCacheGroupLatencies).toHaveBeenCalledWith('12h');
		expect(res.locals['payload']).toEqual({ data: rows });
		expect(next).toHaveBeenCalledOnce();
	});

	test('leaves an absent window absent, so the listing defaults', async () => {
		getCacheGroupLatencies.mockResolvedValueOnce([]);

		const req = { accountability: null, schema: {}, query: {} } as any;
		const next = vi.fn();

		await handlerFor('/cache/latencies')(req, { locals: {} } as any, next);

		expect(getCacheGroupLatencies).toHaveBeenCalledWith(undefined);
	});
});

describe('utils controller /autoscale', () => {
	beforeEach(() => vi.clearAllMocks());

	test('reads the config live, never from the cache it sits behind', async () => {
		const answer = { config: { enabled: true }, source: 'env' };
		readAutoscaleConfig.mockResolvedValueOnce(answer);

		const res = { locals: {} } as any;
		const next = vi.fn();

		const req = { accountability: null, schema: {} } as any;

		await handlerFor('/autoscale')(req, res, next);

		expect(res.locals['cache']).toBe(false);
		expect(res.locals['payload']).toEqual({ data: answer });
		expect(next).toHaveBeenCalledOnce();
	});

	test('hands a patch down as an admin write', async () => {
		updateAutoscaleConfig.mockResolvedValueOnce({ enabled: false });

		const json = vi.fn();
		const res = { status: vi.fn(() => ({ json })) } as any;
		const body = { enabled: false };
		const req = { accountability: null, schema: {}, body } as any;

		await handlerFor('/autoscale', 'patch')(req, res, vi.fn());

		expect(updateAutoscaleConfig).toHaveBeenCalledWith({ enabled: false }, 'admin');
		expect(res.status).toHaveBeenCalledWith(200);
		expect(json).toHaveBeenCalledWith({ data: { enabled: false } });
	});

	test('refuses a patch that is not an object of fields', async () => {
		const res = { status: vi.fn() } as any;

		for (const body of [['enabled'], null, 'enabled']) {
			const req = { accountability: null, schema: {}, body } as any;
			const next = vi.fn();

			// `asyncHandler` hands a thrown error to `next`, it does not reject.
			await handlerFor('/autoscale', 'patch')(req, res, next);

			expect(next.mock.calls[0]![0].message).toContain(
				'An object of autoscale configuration fields is required',
			);
		}

		expect(updateAutoscaleConfig).not.toHaveBeenCalled();
	});

	test('clearing the shared config answers with the absence it leaves', async () => {
		clearAutoscaleConfig.mockResolvedValueOnce(undefined);

		const json = vi.fn();
		const res = { status: vi.fn(() => ({ json })) } as any;

		const req = { accountability: null, schema: {} } as any;

		await handlerFor('/autoscale', 'delete')(req, res, vi.fn());

		expect(clearAutoscaleConfig).toHaveBeenCalledOnce();
		expect(json).toHaveBeenCalledWith({ data: { sharedConfig: null } });
	});

	test('hands the supervisor options down as an admin write', async () => {
		updateSupervisorConfig.mockResolvedValueOnce({ sharedConfig: null });

		const json = vi.fn();
		const res = { status: vi.fn(() => ({ json })) } as any;
		const body = { listenTimeout: 20000 };
		const req = { accountability: null, schema: {}, body } as any;

		await handlerFor('/autoscale/supervisor', 'patch')(req, res, vi.fn());

		expect(updateSupervisorConfig).toHaveBeenCalledWith(body, 'admin');
		expect(json).toHaveBeenCalledWith({ data: { sharedConfig: null } });
	});

	test('refuses supervisor options that are not an object', async () => {
		const res = { status: vi.fn() } as any;
		const req = { accountability: null, schema: {}, body: ['listenTimeout'] } as any;
		const next = vi.fn();

		await handlerFor('/autoscale/supervisor', 'patch')(req, res, next);

		expect(next.mock.calls[0]![0].message).toContain(
			'An object of supervisor options is required',
		);

		expect(updateSupervisorConfig).not.toHaveBeenCalled();
	});

	test('a restart answers with the state the request left behind', async () => {
		const state = { askedAt: 12, running: false, finishedAt: null, error: null };
		startAutoscaleReload.mockResolvedValueOnce(state);

		const json = vi.fn();
		const res = { status: vi.fn(() => ({ json })) } as any;

		await handlerFor('/autoscale/reload', 'post')(
			{ accountability: null, schema: {} } as any,
			res,
			vi.fn(),
		);

		expect(res.status).toHaveBeenCalledWith(200);
		expect(json).toHaveBeenCalledWith({ data: state });
	});
});

describe('utils controller /autoscale/drill', () => {
	beforeEach(() => vi.clearAllMocks());

	test('reads the drill live, never from the cache it sits behind', async () => {
		const drill = { running: false, startedAt: null };
		readAutoscaleDrill.mockResolvedValueOnce(drill);

		const res = { locals: {} } as any;
		const next = vi.fn();

		const req = { accountability: null, schema: {} } as any;

		await handlerFor('/autoscale/drill')(req, res, next);

		expect(res.locals['cache']).toBe(false);
		expect(res.locals['payload']).toEqual({ data: drill });
		expect(next).toHaveBeenCalledOnce();
	});

	test('hands the asked-for duration and load down unread', async () => {
		startAutoscaleDrill.mockResolvedValueOnce({ running: true });

		const json = vi.fn();
		const res = { status: vi.fn(() => ({ json })) } as any;
		const body = { seconds: '30', percent: 80 };
		const req = { accountability: null, schema: {}, body } as any;

		await handlerFor('/autoscale/drill', 'post')(req, res, vi.fn());

		// Unread on purpose: `UtilsService` validates both, so this route and the MCP
		// tool beside it cannot come to disagree about what a drill accepts.
		expect(startAutoscaleDrill).toHaveBeenCalledWith('30', 80);
		expect(json).toHaveBeenCalledWith({ data: { running: true } });
	});

	test('a body that carries no fields asks for the defaults', async () => {
		const res = { status: vi.fn(() => ({ json: vi.fn() })) } as any;

		for (const body of [['seconds'], null, undefined]) {
			startAutoscaleDrill.mockResolvedValueOnce({ running: true });

			await handlerFor('/autoscale/drill', 'post')(
				{ accountability: null, schema: {}, body } as any,
				res,
				vi.fn(),
			);

			expect(startAutoscaleDrill).toHaveBeenLastCalledWith(undefined, undefined);
		}
	});

	test('stopping answers with the drill it stopped', async () => {
		const drill = { running: false, startedAt: 7 };
		stopAutoscaleDrill.mockResolvedValueOnce(drill);

		const json = vi.fn();
		const res = { status: vi.fn(() => ({ json })) } as any;

		await handlerFor('/autoscale/drill', 'delete')(
			{ accountability: null, schema: {} } as any,
			res,
			vi.fn(),
		);

		expect(json).toHaveBeenCalledWith({ data: drill });
	});
});
