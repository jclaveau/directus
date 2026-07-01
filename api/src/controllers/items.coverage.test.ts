import { ForbiddenError } from '@directus/errors';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { withMeta } from '../utils/read-meta.js';

// Per-test service method spies; the ItemsService mock returns this same object so tests drive branches.
const createOne = vi.fn();
const createMany = vi.fn();
const readOne = vi.fn();
const readMany = vi.fn();
const readByQuery = vi.fn();
const readSingleton = vi.fn();
const updateOne = vi.fn();
const updateBatch = vi.fn();
const updateMany = vi.fn();
const updateByQuery = vi.fn();
const upsertSingleton = vi.fn();
const deleteOne = vi.fn();
const deleteMany = vi.fn();
const deleteByQuery = vi.fn();
const getMetaForQuery = vi.fn();

vi.mock('../services/items.js', () => {
	return {
		ItemsService: vi.fn(() => {
			return {
				createOne,
				createMany,
				readOne,
				readMany,
				readByQuery,
				readSingleton,
				updateOne,
				updateBatch,
				updateMany,
				updateByQuery,
				upsertSingleton,
				deleteOne,
				deleteMany,
				deleteByQuery,
			};
		}),
	};
});

vi.mock('../services/meta.js', () => {
	return { MetaService: vi.fn(() => ({ getMetaForQuery })) };
});

vi.mock('../middleware/collection-exists.js', () => ({ default: vi.fn() }));

vi.mock('../middleware/merge-content-versions.js', () => {
	return { mergeContentVersions: vi.fn() };
});

vi.mock('../middleware/validate-batch.js', () => {
	return { validateBatch: vi.fn(() => vi.fn()) };
});

vi.mock('../middleware/respond.js', () => ({ respond: vi.fn() }));
vi.mock('../utils/sanitize-query.js', () => ({ sanitizeQuery: vi.fn(async () => ({})) }));

const { default: router } = await import('./items.js');

// asyncHandler routes thrown/rejected errors to next(error) rather than rejecting; drive the handler and
// return whatever next received so error-path assertions read the routed error.
async function nextError(handler: any, req: any, res: any = { locals: {} }) {
	const next = vi.fn();
	await handler(req, res, next);
	return next.mock.calls[0]?.[0];
}

function handlerFor(method: string, path: string) {
	const layer = router.stack.find(
		(l: any) => l.route && l.route.path === path && l.route.methods[method],
	);

	const sub = layer!.route.stack;
	// collectionExists / validateBatch / mergeContentVersions / respond are stubbed vi.fn()s; only the
	// asyncHandler-wrapped route handler stringifies to the `Promise.resolve(fn(...))` wrapper.
	return sub.find((s: any) => /Promise\.resolve\(fn/.test(s.handle.toString()))!.handle;
}

function makeReq(overrides: any = {}) {
	return {
		params: { collection: 'articles', pk: '1' },
		body: {},
		sanitizedQuery: {},
		accountability: null,
		schema: {},
		collection: 'articles',
		singleton: false,
		path: '/x',
		...overrides,
	};
}

describe('items controller coverage', () => {
	beforeEach(() => vi.clearAllMocks());

	describe('POST /:collection', () => {
		const handler = () => handlerFor('post', '/:collection');

		test('throws ForbiddenError for system collections', async () => {
			const req = makeReq({ params: { collection: 'directus_users' } });
			expect(await nextError(handler(), req)).toBeInstanceOf(ForbiddenError);
		});

		test('throws RouteNotFoundError for singletons', async () => {
			const req = makeReq({ singleton: true });
			expect(await nextError(handler(), req)).toBeInstanceOf(Error);
		});

		test('createMany + readMany for array body', async () => {
			createMany.mockResolvedValueOnce([1, null, 2]);
			readMany.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
			const req = makeReq({ body: [{ a: 1 }, { a: 2 }] });
			const res = { locals: {} } as any;
			const next = vi.fn();
			await handler()(req, res, next);

			expect(createMany).toHaveBeenCalledWith(
				[{ a: 1 }, { a: 2 }],
				{ allowFilterCancel: true },
			);

			expect(readMany).toHaveBeenCalledWith([1, 2], {});
			expect(res.locals['payload']).toEqual({ data: [{ id: 1 }, { id: 2 }] });
			expect(next).toHaveBeenCalledOnce();
		});

		test('createOne + readOne for object body', async () => {
			createOne.mockResolvedValueOnce(5);
			readOne.mockResolvedValueOnce({ id: 5 });
			const req = makeReq({ body: { a: 1 } });
			const res = { locals: {} } as any;
			await handler()(req, res, vi.fn());
			expect(readOne).toHaveBeenCalledWith(5, {});
			expect(res.locals['payload']).toEqual({ data: { id: 5 } });
		});

		test('createOne cancelled by filter hook returns null data', async () => {
			createOne.mockResolvedValueOnce(null);
			const req = makeReq({ body: { a: 1 } });
			const res = { locals: {} } as any;
			await handler()(req, res, vi.fn());
			expect(readOne).not.toHaveBeenCalled();
			expect(res.locals['payload']).toEqual({ data: null });
		});

		test('Forbidden read error calls next() with no error', async () => {
			createOne.mockResolvedValueOnce(5);
			readOne.mockRejectedValueOnce(new ForbiddenError());
			const req = makeReq({ body: { a: 1 } });
			const next = vi.fn();
			await handler()(req, { locals: {} }, next);
			expect(next).toHaveBeenCalledWith();
		});

		test('non-Forbidden read error rethrows', async () => {
			createOne.mockResolvedValueOnce(5);
			readOne.mockRejectedValueOnce(new Error('boom'));
			const req = makeReq({ body: { a: 1 } });
			const err = await nextError(handler(), req);
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe('boom');
		});
	});

	describe('GET /:collection (readHandler)', () => {
		const handler = () => handlerFor('get', '/:collection');

		test('throws ForbiddenError for system collections', async () => {
			const req = makeReq({ params: { collection: 'directus_users' } });
			expect(await nextError(handler(), req)).toBeInstanceOf(ForbiddenError);
		});

		test('singleton read + stamps scopedCacheTags', async () => {
			readSingleton.mockResolvedValueOnce(
				withMeta({ id: 1 }, { scopedCacheTags: [{ collection: 'articles' }] }),
			);

			getMetaForQuery.mockResolvedValueOnce({ total_count: 1 });
			const req = makeReq({ singleton: true, body: {} });
			const res = { locals: {} } as any;
			const next = vi.fn();
			await handler()(req, res, next);
			expect(res.locals['payload'].data).toBeDefined();
			expect(res.locals['scopedCacheTags']).toEqual([{ collection: 'articles' }]);
			expect(next).toHaveBeenCalledOnce();
		});

		test('readMany via body.keys', async () => {
			readMany.mockResolvedValueOnce([{ id: 1 }]);
			getMetaForQuery.mockResolvedValueOnce({});
			const req = makeReq({ body: { keys: [1] } });
			const res = { locals: {} } as any;
			await handler()(req, res, vi.fn());
			expect(readMany).toHaveBeenCalledWith([1], {});
			expect(res.locals['payload'].data).toEqual([{ id: 1 }]);
		});

		test('readByQuery default branch', async () => {
			readByQuery.mockResolvedValueOnce([{ id: 2 }]);
			getMetaForQuery.mockResolvedValueOnce({});
			const req = makeReq({ body: {} });
			const res = { locals: {} } as any;
			await handler()(req, res, vi.fn());
			expect(readByQuery).toHaveBeenCalledOnce();
			expect(res.locals['payload'].data).toEqual([{ id: 2 }]);
		});
	});

	describe('GET /:collection/:pk', () => {
		const handler = () => handlerFor('get', '/:collection/:pk');

		test('throws ForbiddenError for system collections', async () => {
			const req = makeReq({ params: { collection: 'directus_users', pk: '1' } });
			expect(await nextError(handler(), req)).toBeInstanceOf(ForbiddenError);
		});

		test('readOne returns payload', async () => {
			readOne.mockResolvedValueOnce({ id: 1 });
			const req = makeReq();
			const res = { locals: {} } as any;
			const next = vi.fn();
			await handler()(req, res, next);
			expect(readOne).toHaveBeenCalledWith('1', {});
			expect(res.locals['payload']).toEqual({ data: { id: 1 } });
			expect(next).toHaveBeenCalledOnce();
		});
	});

	describe('PATCH /:collection', () => {
		const handler = () => handlerFor('patch', '/:collection');

		test('throws ForbiddenError for system collections', async () => {
			const req = makeReq({ params: { collection: 'directus_users' } });
			expect(await nextError(handler(), req)).toBeInstanceOf(ForbiddenError);
		});

		test('singleton upsert branch', async () => {
			upsertSingleton.mockResolvedValueOnce(undefined);
			readSingleton.mockResolvedValueOnce({ id: 1 });
			const req = makeReq({ singleton: true, body: { a: 1 } });
			const res = { locals: {} } as any;
			const next = vi.fn();
			await handler()(req, res, next);
			expect(upsertSingleton).toHaveBeenCalledWith({ a: 1 });
			expect(res.locals['payload']).toEqual({ data: { id: 1 } });
			expect(next).toHaveBeenCalledOnce();
		});

		test('updateBatch for array body', async () => {
			updateBatch.mockResolvedValueOnce([1, null]);
			readMany.mockResolvedValueOnce([{ id: 1 }]);
			const req = makeReq({ body: [{ a: 1 }] });
			const res = { locals: {} } as any;
			await handler()(req, res, vi.fn());
			expect(updateBatch).toHaveBeenCalledOnce();
			expect(readMany).toHaveBeenCalledWith([1], {});
			expect(res.locals['payload']).toEqual({ data: [{ id: 1 }] });
		});

		test('updateMany via body.keys', async () => {
			updateMany.mockResolvedValueOnce([2]);
			readMany.mockResolvedValueOnce([{ id: 2 }]);
			const req = makeReq({ body: { keys: [2], data: { x: 1 } } });
			const res = { locals: {} } as any;
			await handler()(req, res, vi.fn());
			expect(updateMany).toHaveBeenCalledWith([2], { x: 1 }, { allowFilterCancel: true });
		});

		test('updateByQuery default branch', async () => {
			updateByQuery.mockResolvedValueOnce([3]);
			readMany.mockResolvedValueOnce([{ id: 3 }]);
			const req = makeReq({ body: { query: {}, data: { x: 1 } } });
			const res = { locals: {} } as any;
			await handler()(req, res, vi.fn());
			expect(updateByQuery).toHaveBeenCalledOnce();
		});

		test('Forbidden read error calls next() with no error', async () => {
			updateBatch.mockResolvedValueOnce([1]);
			readMany.mockRejectedValueOnce(new ForbiddenError());
			const req = makeReq({ body: [{ a: 1 }] });
			const next = vi.fn();
			await handler()(req, { locals: {} }, next);
			expect(next).toHaveBeenCalledWith();
		});

		test('non-Forbidden read error rethrows', async () => {
			updateBatch.mockResolvedValueOnce([1]);
			readMany.mockRejectedValueOnce(new Error('boom'));
			const req = makeReq({ body: [{ a: 1 }] });
			const err = await nextError(handler(), req);
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe('boom');
		});
	});

	describe('PATCH /:collection/:pk', () => {
		const handler = () => handlerFor('patch', '/:collection/:pk');

		test('throws ForbiddenError for system collections', async () => {
			const req = makeReq({ params: { collection: 'directus_users', pk: '1' } });
			expect(await nextError(handler(), req)).toBeInstanceOf(ForbiddenError);
		});

		test('throws RouteNotFoundError for singletons', async () => {
			const req = makeReq({ singleton: true });
			expect(await nextError(handler(), req)).toBeInstanceOf(Error);
		});

		test('updateOne + readOne returns payload', async () => {
			updateOne.mockResolvedValueOnce('1');
			readOne.mockResolvedValueOnce({ id: 1 });
			const req = makeReq({ body: { x: 1 } });
			const res = { locals: {} } as any;
			const next = vi.fn();
			await handler()(req, res, next);
			expect(res.locals['payload']).toEqual({ data: { id: 1 } });
			expect(next).toHaveBeenCalledOnce();
		});

		test('Forbidden read error calls next() with no error', async () => {
			updateOne.mockResolvedValueOnce('1');
			readOne.mockRejectedValueOnce(new ForbiddenError());
			const req = makeReq({ body: { x: 1 } });
			const next = vi.fn();
			await handler()(req, { locals: {} }, next);
			expect(next).toHaveBeenCalledWith();
		});

		test('non-Forbidden read error rethrows', async () => {
			updateOne.mockResolvedValueOnce('1');
			readOne.mockRejectedValueOnce(new Error('boom'));
			const req = makeReq({ body: { x: 1 } });
			const err = await nextError(handler(), req);
			expect(err).toBeInstanceOf(Error);
			expect(err.message).toBe('boom');
		});
	});

	describe('DELETE /:collection', () => {
		const handler = () => handlerFor('delete', '/:collection');

		test('throws ForbiddenError for system collections', async () => {
			const req = makeReq({ params: { collection: 'directus_users' } });
			expect(await nextError(handler(), req, undefined)).toBeInstanceOf(ForbiddenError);
		});

		test('deleteMany for array body', async () => {
			deleteMany.mockResolvedValueOnce(undefined);
			const req = makeReq({ body: [1, 2] });
			const next = vi.fn();
			await handler()(req, undefined, next);
			expect(deleteMany).toHaveBeenCalledWith([1, 2], { allowFilterCancel: true });
			expect(next).toHaveBeenCalledOnce();
		});

		test('deleteMany via body.keys', async () => {
			deleteMany.mockResolvedValueOnce(undefined);
			const req = makeReq({ body: { keys: [3] } });
			await handler()(req, undefined, vi.fn());
			expect(deleteMany).toHaveBeenCalledWith([3], { allowFilterCancel: true });
		});

		test('deleteByQuery default branch', async () => {
			deleteByQuery.mockResolvedValueOnce(undefined);
			const req = makeReq({ body: { query: {} } });
			await handler()(req, undefined, vi.fn());
			expect(deleteByQuery).toHaveBeenCalledOnce();
		});
	});

	describe('DELETE /:collection/:pk', () => {
		const handler = () => handlerFor('delete', '/:collection/:pk');

		test('throws ForbiddenError for system collections', async () => {
			const req = makeReq({ params: { collection: 'directus_users', pk: '1' } });
			expect(await nextError(handler(), req, undefined)).toBeInstanceOf(ForbiddenError);
		});

		test('deleteOne returns next', async () => {
			deleteOne.mockResolvedValueOnce(undefined);
			const req = makeReq();
			const next = vi.fn();
			await handler()(req, undefined, next);
			expect(deleteOne).toHaveBeenCalledWith('1', { allowFilterCancel: true });
			expect(next).toHaveBeenCalledOnce();
		});
	});
});
