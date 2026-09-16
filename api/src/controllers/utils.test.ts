import { oneLine } from '@directus/utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const cacheAuditEnabled = vi.fn(() => true);
const getCacheGroupLatencies = vi.fn();
const auditCache = vi.fn();
const getCacheAudits = vi.fn();
const getCacheAudit = vi.fn();
const getCacheAuditSchedule = vi.fn();
const updateCacheAuditSchedule = vi.fn();
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
				auditCache,
				getCacheAudits,
				getCacheAudit,
				getCacheAuditSchedule,
				updateCacheAuditSchedule,
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
// can carry the shared settings and the bus can reach the pool.
vi.mock('../redis/index.js', async (importOriginal) => {
	return {
		...await importOriginal<object>(),
		redisConfigAvailable: () => true,
	};
});

vi.mock('../processes/autoscale/lib/drill.js', () => {
	return { autoscaleDrillEnabled: () => true };
});

vi.mock('../services/import-export.js', () => {
	return { ExportService: vi.fn(), ImportService: vi.fn() };
});

vi.mock('../utils/cache-audit-enabled.js', () => ({ cacheAuditEnabled }));
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

describe('utils controller /cache/audit', () => {
	beforeEach(() => vi.clearAllMocks());

	function request(query: Record<string, unknown>, body: unknown = undefined) {
		return { accountability: null, schema: {}, query, body } as any;
	}

	test(oneLine`
		is absent — a 404, not a 403 — on a node with CACHE_AUDIT_ENABLED off,
		history and schedule included
	`, async () => {
		// The one `router.use` layer in front of the audit routes.
		const gate = router.stack.find((entry: any) => {
			return entry.route === undefined && entry.regexp.test('/cache/audits/7');
		})!.handle as any;

		for (const originalUrl of [
			'/utils/cache/audit',
			'/utils/cache/audits',
			'/utils/cache/audits/7',
			'/utils/cache/audit/schedule',
		]) {
			cacheAuditEnabled.mockReturnValueOnce(false);
			const refused = vi.fn();
			await gate({ originalUrl }, {}, refused);

			expect(refused.mock.calls[0]![0]).toMatchObject({
				status: 404,
				message: `Route ${originalUrl} doesn't exist.`,
			});
		}

		const passed = vi.fn();
		await gate({ originalUrl: '/utils/cache/audit' }, {}, passed);
		expect(passed).toHaveBeenCalledWith();
	});

	test('runs the audit with defaults and answers its report', async () => {
		const report = { scanned: 0, findings: [] };
		auditCache.mockResolvedValueOnce(report);
		const res = { json: vi.fn() } as any;

		await handlerFor('/cache/audit', 'post')(request({}), res, vi.fn());

		expect(auditCache).toHaveBeenCalledWith({ ignore: [], purge: false });
		expect(res.json).toHaveBeenCalledWith({ data: report });
	});

	test(oneLine`
		reads its options off the query and the body, the body winning
	`, async () => {
		auditCache.mockResolvedValueOnce({});

		const req = request(
			{ limit: '10', purge: 'false', ignore: '/meta/served_at' },
			{ purge: true, user: 'user-1', collection: 'articles' },
		);

		await handlerFor('/cache/audit', 'post')(req, { json: vi.fn() } as any, vi.fn());

		expect(auditCache).toHaveBeenCalledWith({
			limit: 10,
			purge: true,
			user: 'user-1',
			collection: 'articles',
			ignore: ['/meta/served_at'],
		});
	});

	test.each([
		[
			'a limit below one',
			{ limit: 0 },
			'"limit" must be greater than or equal to 1',
		],
		['a fractional limit', { limit: 1.5 }, '"limit" must be an integer'],
		[
			'an ignore pattern that is no JSON pointer',
			{ ignore: ['data/*'] },
			'"ignore[0]" with value "data/*" fails to match the required pattern',
		],
		['a purge that is not a boolean', { purge: 'yes' }, '"purge" must be a boolean'],
	])('refuses %s', async (_case, body, reason) => {
		const res = { json: vi.fn() } as any;
		const next = vi.fn();

		await handlerFor('/cache/audit', 'post')(request({}, body), res, next);

		expect(next).toHaveBeenCalledWith(expect.objectContaining({
			code: 'INVALID_QUERY',
			message: expect.stringContaining(reason),
		}));

		expect(res.json).not.toHaveBeenCalled();
		expect(auditCache).not.toHaveBeenCalled();
	});
});

describe('utils controller /cache/audits', () => {
	beforeEach(() => vi.clearAllMocks());

	test('lists the runs live, the window handed down unread', async () => {
		const runs = [{ id: 3, trigger: 'cron' }];
		getCacheAudits.mockResolvedValueOnce(runs);
		const res = { locals: {} } as any;
		const next = vi.fn();

		await handlerFor('/cache/audits')(
			{ accountability: null, schema: {}, query: { window: '3d' } } as any,
			res,
			next,
		);

		expect(getCacheAudits).toHaveBeenCalledWith('3d');
		expect(res.locals['cache']).toBe(false);
		expect(res.locals['payload']).toEqual({ data: runs });
		expect(next).toHaveBeenCalledOnce();
	});

	test('reads one run by the id in the path', async () => {
		const run = { id: 3, findings: [] };
		getCacheAudit.mockResolvedValueOnce(run);
		const res = { locals: {} } as any;

		await handlerFor('/cache/audits/:id')(
			{ accountability: null, schema: {}, query: {}, params: { id: '3' } } as any,
			res,
			vi.fn(),
		);

		expect(getCacheAudit).toHaveBeenCalledWith('3');
		expect(res.locals['cache']).toBe(false);
		expect(res.locals['payload']).toEqual({ data: run });
	});

	test('answers the schedule in force, never from the cache', async () => {
		const state = { rule: '0 3 * * *', source: 'env' };
		getCacheAuditSchedule.mockResolvedValueOnce(state);
		const res = { locals: {} } as any;

		await handlerFor('/cache/audit/schedule')(
			{ accountability: null, schema: {}, query: {} } as any,
			res,
			vi.fn(),
		);

		expect(res.locals['cache']).toBe(false);
		expect(res.locals['payload']).toEqual({ data: state });
	});

	test('writes the rule off the body, null clearing it', async () => {
		const state = { rule: null, source: null };
		updateCacheAuditSchedule.mockResolvedValueOnce(state);
		const res = { json: vi.fn() } as any;

		await handlerFor('/cache/audit/schedule', 'patch')(
			{ accountability: null, schema: {}, body: { rule: null } } as any,
			res,
			vi.fn(),
		);

		expect(updateCacheAuditSchedule).toHaveBeenCalledWith(null);
		expect(res.json).toHaveBeenCalledWith({ data: state });
	});

	test('refuses a schedule write that names no rule', async () => {
		const next = vi.fn();

		await handlerFor('/cache/audit/schedule', 'patch')(
			{ accountability: null, schema: {}, body: {} } as any,
			{ json: vi.fn() } as any,
			next,
		);

		expect(next).toHaveBeenCalledWith(expect.objectContaining({
			code: 'INVALID_PAYLOAD',
			message: expect.stringContaining('A `rule` is required'),
		}));

		expect(updateCacheAuditSchedule).not.toHaveBeenCalled();
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

	test('clearing the settings answers with the absence it leaves', async () => {
		clearAutoscaleConfig.mockResolvedValueOnce(undefined);

		const json = vi.fn();
		const res = { status: vi.fn(() => ({ json })) } as any;

		const req = { accountability: null, schema: {} } as any;

		await handlerFor('/autoscale', 'delete')(req, res, vi.fn());

		expect(clearAutoscaleConfig).toHaveBeenCalledOnce();
		expect(json).toHaveBeenCalledWith({ data: { sharedSettings: null } });
	});

	test('hands the supervisor options down as an admin write', async () => {
		updateSupervisorConfig.mockResolvedValueOnce({ sharedSettings: null });

		const json = vi.fn();
		const res = { status: vi.fn(() => ({ json })) } as any;
		const body = { listenTimeout: 20000 };
		const req = { accountability: null, schema: {}, body } as any;

		await handlerFor('/autoscale/supervisor', 'patch')(req, res, vi.fn());

		expect(updateSupervisorConfig).toHaveBeenCalledWith(body, 'admin');
		expect(json).toHaveBeenCalledWith({ data: { sharedSettings: null } });
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
