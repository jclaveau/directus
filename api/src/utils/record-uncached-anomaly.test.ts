import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	return {
		getCacheKey: vi.fn(),
		captureCacheDescriptor: vi.fn().mockResolvedValue(undefined),
		claimAnomalySlot: vi.fn().mockResolvedValue(true),
		emitCacheAnomaly: vi.fn(),
		getGraphqlQueryAndVariables: vi.fn(() => ({ query: '{ me }', variables: {} })),
	};
});

vi.mock('../cache-events.js', () => {
	return {
		captureCacheDescriptor: mocks.captureCacheDescriptor,
		claimAnomalySlot: mocks.claimAnomalySlot,
		emitCacheAnomaly: mocks.emitCacheAnomaly,
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
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.claimAnomalySlot.mockResolvedValue(true);
	});

	it('claims the slot, writes a descriptor then the anomaly, keyed by the cache key', async () => {
		mocks.getCacheKey.mockResolvedValueOnce({ key: 'rk1', hash: 'h1' });

		await recordUncachedAnomaly(makeReq(), 'value_too_large', '2048B');

		expect(mocks.claimAnomalySlot).toHaveBeenCalledWith('value_too_large', 'h1');

		expect(mocks.captureCacheDescriptor).toHaveBeenCalledWith(
			expect.objectContaining({
				cacheKey: 'h1',
				redisKey: 'rk1',
				method: 'GET',
				path: '/items/articles',
				collection: 'articles',
				userId: 'u1',
				query: JSON.stringify({ limit: 5 }),
				url: '/items/articles?limit=5',
				bytes: 0,
				fillMs: 0,
				locator: true,
			}),
		);

		expect(mocks.emitCacheAnomaly).toHaveBeenCalledWith({
			cacheKey: 'h1',
			reason: 'value_too_large',
			detail: '2048B',
		});
	});

	it('records a graphql request with a blank url + the graphql query', async () => {
		mocks.getCacheKey.mockResolvedValueOnce({ key: 'rk2', hash: 'h2' });

		const req = makeReq({ method: 'POST', originalUrl: '/graphql' });
		await recordUncachedAnomaly(req, 'missing_scope');

		expect(mocks.captureCacheDescriptor).toHaveBeenCalledWith(
			expect.objectContaining({
				cacheKey: 'h2',
				redisKey: 'rk2',
				url: '',
				query: JSON.stringify({ query: '{ me }', variables: {} }),
			}),
		);

		expect(mocks.emitCacheAnomaly).toHaveBeenCalledWith({
			cacheKey: 'h2',
			reason: 'missing_scope',
			detail: null,
		});
	});

	it('writes nothing when the throttle slot is already claimed', async () => {
		mocks.getCacheKey.mockResolvedValueOnce({ key: 'rk3', hash: 'h3' });
		mocks.claimAnomalySlot.mockResolvedValueOnce(false);

		await recordUncachedAnomaly(makeReq(), 'missing_scope');

		expect(mocks.captureCacheDescriptor).not.toHaveBeenCalled();
		expect(mocks.emitCacheAnomaly).not.toHaveBeenCalled();
	});
});
