import { beforeEach, describe, expect, test, vi } from 'vitest';

const getCacheGroupLatencies = vi.fn();

vi.mock('../services/utils.js', () => {
	return { UtilsService: vi.fn(() => ({ getCacheGroupLatencies })) };
});

vi.mock('../services/import-export.js', () => {
	return { ExportService: vi.fn(), ImportService: vi.fn() };
});

vi.mock('../services/revisions.js', () => ({ RevisionsService: vi.fn() }));
vi.mock('../middleware/respond.js', () => ({ respond: vi.fn() }));
vi.mock('../middleware/collection-exists.js', () => ({ default: vi.fn() }));

const { default: router } = await import('./utils.js');

// router.get(path, asyncHandler(fn), respond) registers one Route layer whose own
// stack holds [handler, respond]; drive the bare handler, as server.test.ts does.
function handlerFor(path: string) {
	const layer = router.stack.find((entry: any) => entry.route?.path === path);

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
