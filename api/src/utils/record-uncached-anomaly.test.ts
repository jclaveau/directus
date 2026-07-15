import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	return {
		getCacheKey: vi.fn(),
		captureCacheDescriptor: vi.fn().mockResolvedValue(undefined),
		captureCacheAnomaly: vi.fn().mockResolvedValue(undefined),
		getGraphqlQueryAndVariables: vi.fn(() => ({ query: '{ me }', variables: {} })),
	};
});

vi.mock('../cache-events.js', () => {
	return {
		captureCacheDescriptor: mocks.captureCacheDescriptor,
		captureCacheAnomaly: mocks.captureCacheAnomaly,
	};
});

vi.mock('./get-cache-key.js', () => ({ getCacheKey: mocks.getCacheKey }));

vi.mock('./get-graphql-query-and-variables.js', () => {
	return { getGraphqlQueryAndVariables: mocks.getGraphqlQueryAndVariables };
});

import { recordUncachedAnomaly } from './record-uncached-anomaly.js';

function makeReq(overrides: Partial<Request> = {}): Request {
	return {
		method: 'GET',
		originalUrl: '/items/articles?limit=5',
		sanitizedQuery: { limit: 5 },
		accountability: { user: 'u1' },
		collection: 'articles',
		...overrides,
	} as unknown as Request;
}

describe('recordUncachedAnomaly', () => {
	it('writes a descriptor then the anomaly, keyed by the cache key', async () => {
		mocks.getCacheKey.mockResolvedValueOnce('k1');

		await recordUncachedAnomaly(makeReq(), 'value_too_large', '2048B');

		expect(mocks.captureCacheDescriptor).toHaveBeenCalledWith(
			expect.objectContaining({
				cacheKey: 'k1',
				method: 'GET',
				path: '/items/articles',
				collection: 'articles',
				userId: 'u1',
				query: JSON.stringify({ limit: 5 }),
				url: '/items/articles?limit=5',
				bytes: 0,
				fillMs: 0,
			}),
		);

		expect(mocks.captureCacheAnomaly).toHaveBeenCalledWith({
			cacheKey: 'k1',
			reason: 'value_too_large',
			detail: '2048B',
		});
	});

	it('records a graphql request with a blank url + the graphql query', async () => {
		mocks.getCacheKey.mockResolvedValueOnce('k2');

		const req = makeReq({ method: 'POST', originalUrl: '/graphql' });
		await recordUncachedAnomaly(req, 'scoped_orphan');

		expect(mocks.captureCacheDescriptor).toHaveBeenCalledWith(
			expect.objectContaining({
				cacheKey: 'k2',
				url: '',
				query: JSON.stringify({ query: '{ me }', variables: {} }),
			}),
		);

		expect(mocks.captureCacheAnomaly).toHaveBeenCalledWith({
			cacheKey: 'k2',
			reason: 'scoped_orphan',
			detail: null,
		});
	});
});
