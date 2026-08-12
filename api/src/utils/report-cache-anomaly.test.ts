import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	return {
		getCacheKey: vi.fn(),
		queueCacheDescriptor: vi.fn().mockResolvedValue(undefined),
		claimCacheAnomalyThrottleSlot: vi.fn().mockResolvedValue(true),
		queueCacheAnomaly: vi.fn(),
		getGraphqlQueryAndVariables: vi.fn(() => ({ query: '{ me }', variables: {} })),
	};
});

vi.mock('../cache-events.js', () => {
	return {
		queueCacheDescriptor: mocks.queueCacheDescriptor,
		claimCacheAnomalyThrottleSlot: mocks.claimCacheAnomalyThrottleSlot,
		queueCacheAnomaly: mocks.queueCacheAnomaly,
	};
});

vi.mock('./get-cache-key.js', () => ({ getCacheKey: mocks.getCacheKey }));

vi.mock('./get-graphql-query-and-variables.js', () => {
	return { getGraphqlQueryAndVariables: mocks.getGraphqlQueryAndVariables };
});

import { reportCacheAnomaly } from './report-cache-anomaly.js';

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

describe('reportCacheAnomaly', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.claimCacheAnomalyThrottleSlot.mockResolvedValue(true);
	});

	it('claims the slot, then writes the descriptor + anomaly', async () => {
		mocks.getCacheKey.mockResolvedValueOnce({ key: 'rk1', hash: 'h1' });

		await reportCacheAnomaly(makeReq(), 'value_too_large', '2048B');

		expect(mocks.claimCacheAnomalyThrottleSlot)
			.toHaveBeenCalledWith('value_too_large', 'h1');

		expect(mocks.queueCacheDescriptor).toHaveBeenCalledWith(
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
				// A locator resolved no scope, so it carries no tags. Asserted
				// rather than assumed: the descriptor emitter joins this array, so
				// omitting it throws and the locator is never written at all —
				// which reads downstream as an anomaly with no descriptor.
				scopedCacheTags: [],
				lastFilled: null,
			}),
		);

		expect(mocks.queueCacheAnomaly).toHaveBeenCalledWith({
			cacheKey: 'h1',
			reason: 'value_too_large',
			detail: '2048B',
		});
	});

	it('records a graphql request with a blank url + the graphql query', async () => {
		mocks.getCacheKey.mockResolvedValueOnce({ key: 'rk2', hash: 'h2' });

		const req = makeReq({ method: 'POST', originalUrl: '/graphql' });
		await reportCacheAnomaly(req, 'missing_scope');

		expect(mocks.queueCacheDescriptor).toHaveBeenCalledWith(
			expect.objectContaining({
				cacheKey: 'h2',
				redisKey: 'rk2',
				url: '',
				query: JSON.stringify({ query: '{ me }', variables: {} }),
			}),
		);

		expect(mocks.queueCacheAnomaly).toHaveBeenCalledWith({
			cacheKey: 'h2',
			reason: 'missing_scope',
			detail: null,
		});
	});

	it('writes nothing when the throttle slot is already claimed', async () => {
		mocks.getCacheKey.mockResolvedValueOnce({ key: 'rk3', hash: 'h3' });
		mocks.claimCacheAnomalyThrottleSlot.mockResolvedValueOnce(false);

		await reportCacheAnomaly(makeReq(), 'missing_scope');

		expect(mocks.queueCacheDescriptor).not.toHaveBeenCalled();
		expect(mocks.queueCacheAnomaly).not.toHaveBeenCalled();
	});
});
