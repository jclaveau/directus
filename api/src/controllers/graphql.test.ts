import { oneLine } from '@directus/utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { withMeta } from '../utils/read-meta.js';
import {
	bareScopedCacheFingerprint,
	scopedCacheReadMeta,
} from '../scoped-cache.js';

// Stub the middleware + service the router pulls in so we can drive the bare async handlers without a
// generated schema or a real express request lifecycle.
const execute = vi.fn();

vi.mock('../services/graphql/index.js', () => {
	return { GraphQLService: vi.fn(() => ({ execute })) };
});

vi.mock('../middleware/graphql.js', () => ({ parseGraphQL: vi.fn() }));
vi.mock('../middleware/respond.js', () => ({ respond: vi.fn() }));

const { default: router } = await import('./graphql.js');

// Express 4 registers each `router.use(path, ...fns)` middleware as its own top-level layer with the
// mount regexp; the only async (asyncHandler-wrapped) layers are the two GraphQLService handlers. The
// '/system' mount matches '/system' but not '/items'; the catch-all '/' mount matches both.
const isHandler = (layer: any) => /Promise\.resolve\(fn/.test(layer.handle.toString());

function systemHandler() {
	return router.stack.find(
		(layer: any) =>
			isHandler(layer) && layer.regexp.test('/system') && !layer.regexp.test('/items'),
	)!.handle;
}

function itemsHandler() {
	return router.stack.find(
		(layer: any) => isHandler(layer) && layer.regexp.test('/items'),
	)!.handle;
}

describe('graphql controller scopedCacheFingerprints', () => {
	beforeEach(() => vi.clearAllMocks());

	test.each([
		['system', systemHandler],
		['items', itemsHandler],
	])(oneLine`
		%s handler stamps scopedCacheFingerprints from the payload meta
	`, async (_scope, getHandler) => {
		const fingerprints = [bareScopedCacheFingerprint('articles')];

		execute.mockResolvedValueOnce(
			withMeta(
				{ data: { ok: true } },
				scopedCacheReadMeta(fingerprints),
			),
		);

		const req = { accountability: null, schema: {} } as any;
		const res = { locals: { graphqlParams: {} } } as any;
		const next = vi.fn();

		await getHandler()(req, res, next);

		expect(res.locals['scopedCacheFingerprints']).toEqual(fingerprints);
		expect(res.locals['cache']).toBeUndefined();
		expect(next).toHaveBeenCalledOnce();
	});

	test.each([
		['system', systemHandler],
		['items', itemsHandler],
	])(oneLine`
		%s handler disables cache when the payload has errors
	`, async (_scope, getHandler) => {
		execute.mockResolvedValueOnce(
			withMeta({ errors: [{ message: 'x' }] }, scopedCacheReadMeta([])),
		);

		const req = { accountability: null, schema: {} } as any;
		const res = { locals: { graphqlParams: {} } } as any;
		const next = vi.fn();

		await getHandler()(req, res, next);

		expect(res.locals['cache']).toBe(false);
		expect(next).toHaveBeenCalledOnce();
	});
});
