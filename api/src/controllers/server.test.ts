import { beforeEach, describe, expect, test, vi } from 'vitest';

const serverInfo = vi.fn();

vi.mock('../services/server.js', () => {
	return {
		ServerService: vi.fn(function () {
			return { serverInfo };
		}),
	};
});

vi.mock('../services/specifications.js', () => {
	return { SpecificationService: vi.fn() };
});

vi.mock('../middleware/respond.js', () => ({ respond: vi.fn() }));

const scopedCachePurgeEnabled = vi.fn();

vi.mock('../scoped-cache/index.js', () => {
	return { scopedCachePurgeEnabled: () => scopedCachePurgeEnabled() };
});

const { readCoverage, dumpCoverage } = vi.hoisted(() => {
	return { readCoverage: vi.fn(), dumpCoverage: vi.fn() };
});

vi.mock('../utils/dump-coverage.js', () => ({ readCoverage, dumpCoverage }));

const { default: router } = await import('./server.js');

async function callInfo() {
	serverInfo.mockResolvedValueOnce({ project_name: 'x' });

	const req = { accountability: null, schema: {} } as any;
	const res = { locals: {} } as any;
	const next = vi.fn();

	// router.get('/info', asyncHandler(fn), respond) registers one Route layer
	// whose own stack holds [handler, respond]; drive the bare handler here.
	const layer = router.stack.find((l: any) => l.route?.path === '/info');
	await layer!.route!.stack[0]!.handle(req, res, next);

	return { res, next };
}

describe('server controller /info', () => {
	beforeEach(() => vi.clearAllMocks());

	test('opts out under scoped purge, so respond skips the anomaly', async () => {
		scopedCachePurgeEnabled.mockReturnValue(true);

		const { res, next } = await callInfo();

		expect(res.locals['cache']).toBe(false);
		expect(res.locals['payload']).toEqual({ data: { project_name: 'x' } });
		expect(next).toHaveBeenCalledOnce();
	});

	test('stays cacheable under full purge, where nothing can go stale', async () => {
		scopedCachePurgeEnabled.mockReturnValue(false);

		const { res, next } = await callInfo();

		// Untouched rather than `true`: the route makes no claim, it just declines to
		// veto, and respond's own rules decide from there.
		expect(res.locals['cache']).toBeUndefined();
		expect(res.locals['payload']).toEqual({ data: { project_name: 'x' } });
		expect(next).toHaveBeenCalledOnce();
	});
});

describe('server controller POST /coverage', () => {
	beforeEach(() => vi.clearAllMocks());

	async function callCoverage() {
		const req = { path: '/coverage' } as any;
		const res = { locals: {} } as any;
		const next = vi.fn();

		const layer = router.stack.find((l: any) => l.route?.path === '/coverage');
		await layer!.route!.stack[0]!.handle(req, res, next);

		return { res, next };
	}

	test('answers 404 in a build with nothing instrumented', async () => {
		readCoverage.mockReturnValue(undefined);

		const { res, next } = await callCoverage();

		expect(next).toHaveBeenCalledWith(expect.objectContaining({
			status: 404,
			message: 'Route /coverage doesn\'t exist.',
		}));

		expect(dumpCoverage).not.toHaveBeenCalled();
		expect(res.locals['payload']).toBeUndefined();
	});

	test('answers with the directories it wrote', async () => {
		readCoverage.mockReturnValue({ 'src/app.ts': {} });

		dumpCoverage.mockResolvedValue([
			{ dir: '/repo/ext/coverage/.tmp/backend', fileCount: 121 },
		]);

		const { res, next } = await callCoverage();

		expect(res.locals['payload']).toEqual({
			data: {
				written: [{ dir: '/repo/ext/coverage/.tmp/backend', fileCount: 121 }],
			},
		});

		expect(next).toHaveBeenCalledWith();
	});
});
