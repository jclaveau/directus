import { beforeEach, describe, expect, test, vi } from 'vitest';

const serverInfo = vi.fn();

vi.mock('../services/server.js', () => {
	return { ServerService: vi.fn(() => ({ serverInfo })) };
});

vi.mock('../services/specifications.js', () => {
	return { SpecificationService: vi.fn() };
});

vi.mock('../middleware/respond.js', () => ({ respond: vi.fn() }));

const { default: router } = await import('./server.js');

// router.get('/info', asyncHandler(fn), respond) registers one Route layer whose
// own stack holds [handler, respond]; drive the bare handler, respond is mocked.
function infoHandler() {
	const layer = router.stack.find((l: any) => l.route?.path === '/info');
	return layer!.route.stack[0].handle;
}

describe('server controller /info', () => {
	beforeEach(() => vi.clearAllMocks());

	test('opts out of cache so respond skips the missing_scope anomaly', async () => {
		serverInfo.mockResolvedValueOnce({ project_name: 'x' });

		const req = { accountability: null, schema: {} } as any;
		const res = { locals: {} } as any;
		const next = vi.fn();

		await infoHandler()(req, res, next);

		expect(res.locals['cache']).toBe(false);
		expect(res.locals['payload']).toEqual({ data: { project_name: 'x' } });
		expect(next).toHaveBeenCalledOnce();
	});
});
