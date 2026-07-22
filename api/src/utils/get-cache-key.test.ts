import { useEnv } from '@directus/env';
import type { Request } from 'express';
import type { Knex } from 'knex';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { fetchPoliciesIpAccess } from '../permissions/modules/fetch-policies-ip-access/fetch-policies-ip-access.js';
import { getDatabase } from '../database/index.js';
import { getCacheKey } from './get-cache-key.js';
import * as getGraphqlQueryUtil from './get-graphql-query-and-variables.js';

vi.mock('../database/index.js');

vi.mock('../permissions/modules/fetch-policies-ip-access/fetch-policies-ip-access.js');

vi.mock('directus/version', () => ({ version: '1.2.3' }));

vi.mock('@directus/env', () => ({
	useEnv: vi.fn().mockReturnValue({
		REDIS_ENABLED: false,
	}),
}));

beforeEach(() => {
	vi.mocked(getDatabase).mockReturnValue({} as Knex);
});

const baseUrl = 'http://localhost';
const restUrl = `${baseUrl}/items/example`;
const graphQlUrl = `${baseUrl}/graphql`;
const accountability = { user: '00000000-0000-0000-0000-000000000000' };
const method = 'GET';

const requests = [
	{
		name: 'as unauthenticated request',
		params: { method, originalUrl: restUrl },
		key: '20ada3d7cc37fb7e742d2a723f6f1d7a64686d2e',
	},
	{
		name: 'as authenticated request',
		params: { method, originalUrl: restUrl, accountability },
		key: '79daba5bf38b6b80cb4bf4e2de95d6a8380f7927',
	},
	{
		name: 'a request with a fields query',
		params: { method, originalUrl: restUrl, sanitizedQuery: { fields: ['id', 'name'] } },
		key: 'e1839f7379b39188622e797fdbe2e3e6d477cbdc',
	},
	{
		name: 'a request with a filter query',
		params: { method, originalUrl: restUrl, sanitizedQuery: { filter: { name: { _eq: 'test' } } } },
		key: '0bcc9af5f628db85043133e59226b2de154d7183',
	},
	{
		name: 'a GraphQL GET query request',
		params: { method, originalUrl: graphQlUrl, query: { query: 'query { test { id } }' } },
		key: '14bc276cf21e2d22334b84841533e2c8e1bba9bd',
	},
	{
		name: 'a GraphQL POST query request',
		params: { method: 'POST', originalUrl: graphQlUrl, body: { query: 'query { test { name } }' } },
		key: 'c5bf03e138e0f7bbaa50dde9cad554bef47a81d2',
	},
	{
		name: 'an authenticated GraphQL GET query request',
		params: { method, originalUrl: graphQlUrl, accountability, query: { query: 'query { test { id } }' } },
		key: '981f27be4c0cfed0b4eca6ac2514f6629aea6be1',
	},
	{
		name: 'an authenticated GraphQL POST query request',
		params: { method: 'POST', originalUrl: graphQlUrl, accountability, body: { query: 'query { test { name } }' } },
		key: '358336a2c61f7ea2b41b5c1566bbebe692be601d',
	},
];

const cases = requests.map(({ name, params, key }) => [name, params, key]);

beforeEach(() => {
	vi.mocked(useEnv).mockReturnValue({});
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('get cache key', async () => {
	describe('isGraphQl', async () => {
		let getGraphqlQuerySpy: MockInstance;

		beforeAll(() => {
			getGraphqlQuerySpy = vi.spyOn(getGraphqlQueryUtil, 'getGraphqlQueryAndVariables');
		});

		test.each(['/items/test', '/items/graphql', '/collections/test', '/collections/graphql'])(
			'path "%s" should not be interpreted as a graphql query',
			async (path) => {
				await getCacheKey({ originalUrl: `${baseUrl}${path}` } as Request);
				expect(getGraphqlQuerySpy).not.toHaveBeenCalled();
			},
		);

		test.each(['/graphql', '/graphql/system'])('path "%s" should be interpreted as a graphql query', async (path) => {
			await getCacheKey({ originalUrl: `${baseUrl}${path}` } as Request);
			expect(getGraphqlQuerySpy).toHaveBeenCalledOnce();
		});
	});

	test.each(cases)('should create a cache key for %s', async (_, params, key) => {
		const { key: redisKey, hash } = await getCacheKey(params as unknown as Request);
		// Hashing on (default): the Redis key and the stats hash are the same digest.
		expect(hash).toEqual(key);
		expect(redisKey).toEqual(key);
	});

	test('should create a unique key for each request', async () => {
		const keys = await Promise.all(
			cases.map(async ([, params]) => {
				const { hash } = await getCacheKey(params as unknown as Request);
				return hash;
			}),
		);

		const hasDuplicate = keys.some((key) => keys.indexOf(key) !== keys.lastIndexOf(key));

		expect(hasDuplicate).toBeFalsy();
	});

	test('should create a unique key for GraphQL requests with different variables', async () => {
		const query = 'query Test ($name: String) { test (filter: { name: { _eq: $name } }) { id } }';
		const operationName = 'test';
		const variables1 = JSON.stringify({ name: 'test 1' });
		const variables2 = JSON.stringify({ name: 'test 2' });
		const req1: any = { method, originalUrl: graphQlUrl, query: { query, operationName, variables: variables1 } };
		const req2: any = { method, originalUrl: graphQlUrl, query: { query, operationName, variables: variables2 } };
		const postReq1: any = { method: 'POST', originalUrl: req1.originalUrl, body: req1.query };
		const postReq2: any = { method: 'POST', originalUrl: req2.originalUrl, body: req2.query };

		expect(await getCacheKey(req1)).not.toEqual(await getCacheKey(req2));
		expect(await getCacheKey(postReq1)).not.toEqual(await getCacheKey(postReq2));
		expect(await getCacheKey(req1)).toEqual(await getCacheKey(postReq1));
		expect(await getCacheKey(req2)).toEqual(await getCacheKey(postReq2));
	});

	test('it should create a unique key for requests which match a policy ip_access filter', async () => {
		const reqWithMatchingIp: any = {
			method,
			originalUrl: restUrl,
			accountability: { ...accountability, ip: '127.0.0.1' },
		};

		const reqWithNotMatchingIp: any = {
			method,
			originalUrl: restUrl,
			accountability: { ...accountability, ip: '127.0.0.2' },
		};

		const reqWithoutIp: any = { method, originalUrl: restUrl, accountability: { ...accountability } };

		vi.mocked(fetchPoliciesIpAccess).mockResolvedValue([['127.0.0.1']]);

		expect(await getCacheKey(reqWithMatchingIp)).not.toEqual(await getCacheKey(reqWithoutIp));
		expect(await getCacheKey(reqWithNotMatchingIp)).toEqual(await getCacheKey(reqWithoutIp));
	});

	describe('CACHE_KEY_HASH_ENABLED=false (readable dev key)', () => {
		beforeEach(() => {
			vi.mocked(useEnv).mockReturnValue({ CACHE_KEY_HASH_ENABLED: false });
		});

		test('returns the readable request descriptor instead of a hash', async () => {
			const { key, hash } = await getCacheKey({
				method,
				originalUrl: restUrl,
				accountability,
				sanitizedQuery: { fields: ['id', 'name'] },
			} as unknown as Request);

			expect(key).toContain('"path":"/items/example"');
			expect(key).toContain(`"user":"${accountability.user}"`);
			expect(key).toContain('"fields":["id","name"]');
			expect(key).toContain('"version":"1.2.3"');
			// The stats hash stays a fixed-length digest even for a readable Redis key.
			expect(hash).toMatch(/^[0-9a-f]{40}$/);
		});

		test('canonical key order → equivalent queries share one key', async () => {
			const filter = { _and: [{ a: { _eq: 1 } }, { b: { _eq: 2 } }] };

			const filterFirst: any = {
				method,
				originalUrl: restUrl,
				sanitizedQuery: { filter, fields: ['id'] },
			};

			const fieldsFirst: any = {
				method,
				originalUrl: restUrl,
				sanitizedQuery: { fields: ['id'], filter },
			};

			const filterFirstKey = await getCacheKey(filterFirst);
			const fieldsFirstKey = await getCacheKey(fieldsFirst);

			expect(filterFirstKey).toEqual(fieldsFirstKey);
		});

		test('still keys per user — no cross-user collision', async () => {
			const asUserA: any = {
				method,
				originalUrl: restUrl,
				accountability: { user: 'aaaaaaaa-0000-0000-0000-000000000000' },
			};

			const asUserB: any = {
				method,
				originalUrl: restUrl,
				accountability: { user: 'bbbbbbbb-0000-0000-0000-000000000000' },
			};

			expect(await getCacheKey(asUserA)).not.toEqual(await getCacheKey(asUserB));
		});
	});
});

function varyRequest(overrides: Record<string, any> = {}): Request {
	return { method, originalUrl: restUrl, ...overrides } as unknown as Request;
}

function acceptLanguage(value: string): Request {
	return varyRequest({ headers: { 'accept-language': value } });
}

describe('Accept-Language dimension (always on)', () => {
	beforeEach(() => {
		vi.mocked(useEnv).mockReturnValue({});
	});

	test('a header-less request keeps the language-agnostic key', async () => {
		const without = await getCacheKey(varyRequest());
		const star = await getCacheKey(acceptLanguage('*'));

		expect(star.hash).toEqual(without.hash);
	});

	test('the primary language is folded in when the caller sends one', async () => {
		const base = await getCacheKey(varyRequest());
		const fr = await getCacheKey(acceptLanguage('fr'));

		expect(fr.hash).not.toEqual(base.hash);
	});

	test('different languages get different keys', async () => {
		const fr = await getCacheKey(acceptLanguage('fr'));
		const en = await getCacheKey(acceptLanguage('en'));

		expect(fr.hash).not.toEqual(en.hash);
	});

	test('region and q-weights collapse to the primary tag', async () => {
		const canonical = await getCacheKey(acceptLanguage('fr'));

		for (const header of ['fr-FR', 'fr-CA,fr;q=0.9', 'en;q=0.5,fr;q=0.9', 'FR']) {
			const variant = await getCacheKey(acceptLanguage(header));

			expect(variant.hash).toEqual(canonical.hash);
		}
	});

	test('trims OWS between the tag and its q-param', async () => {
		const canonical = await getCacheKey(acceptLanguage('fr'));
		const spaced = await getCacheKey(acceptLanguage('fr ;q=0.9'));

		expect(spaced.hash).toEqual(canonical.hash);
	});
});

describe('CACHE_VARY_CONTENT_TYPES dimension (opt-in)', () => {
	test('unset: the negotiated content type does not enter the key', async () => {
		vi.mocked(useEnv).mockReturnValue({});

		const csv = await getCacheKey(varyRequest({ accepts: () => 'csv' }));
		const json = await getCacheKey(varyRequest({ accepts: () => 'json' }));

		expect(csv.hash).toEqual(json.hash);
	});

	test('set: negotiates the request against the declared list', async () => {
		vi.mocked(useEnv).mockReturnValue({ CACHE_VARY_CONTENT_TYPES: ['json', 'csv'] });

		const accepts = vi.fn().mockReturnValue('csv');
		await getCacheKey(varyRequest({ accepts }));

		expect(accepts).toHaveBeenCalledWith(['json', 'csv']);
	});

	test('set: each type and the unsupported bucket get their own key', async () => {
		vi.mocked(useEnv).mockReturnValue({ CACHE_VARY_CONTENT_TYPES: ['json', 'csv'] });

		const csv = await getCacheKey(varyRequest({ accepts: () => 'csv' }));
		const json = await getCacheKey(varyRequest({ accepts: () => 'json' }));
		const unsupported = await getCacheKey(varyRequest({ accepts: () => false }));

		expect(csv.hash).not.toEqual(json.hash);
		expect(unsupported.hash).not.toEqual(csv.hash);
		expect(unsupported.hash).not.toEqual(json.hash);
	});

	test('trims and dedupes the list, preserving order (not sorted)', async () => {
		vi.mocked(useEnv).mockReturnValue({
			CACHE_VARY_CONTENT_TYPES: ['json', ' csv ', 'json'],
		});

		const accepts = vi.fn().mockReturnValue('csv');
		await getCacheKey(varyRequest({ accepts }));

		// order preserved so cache negotiation mirrors the endpoint's req.accepts()
		expect(accepts).toHaveBeenCalledWith(['json', 'csv']);
	});
});

describe('CACHE_VARY_REQUEST_HEADERS dimension (opt-in)', () => {
	function varyHeaders(patterns: string[]): void {
		vi.mocked(useEnv).mockReturnValue({ CACHE_VARY_REQUEST_HEADERS: patterns });
	}

	function tenant(value: string): Request {
		return varyRequest({ headers: { 'x-tenant-id': value } });
	}

	function feature(value: string): Request {
		return varyRequest({ headers: { 'x-feature-beta': value } });
	}

	test('unset: request headers do not enter the key', async () => {
		vi.mocked(useEnv).mockReturnValue({});

		const a = await getCacheKey(tenant('a'));
		const b = await getCacheKey(tenant('b'));

		expect(a.hash).toEqual(b.hash);
	});

	test('exact name: distinct values split; absence is its own bucket', async () => {
		varyHeaders(['x-tenant-id']);

		const a = await getCacheKey(tenant('a'));
		const b = await getCacheKey(tenant('b'));
		const absent = await getCacheKey(varyRequest({ headers: {} }));

		expect(a.hash).not.toEqual(b.hash);
		expect(absent.hash).not.toEqual(a.hash);
	});

	test('unlisted proxy headers are ignored', async () => {
		varyHeaders(['x-tenant-id']);

		const one = await getCacheKey(
			varyRequest({ headers: { 'x-tenant-id': 'a', 'x-request-id': '111' } }),
		);

		const two = await getCacheKey(
			varyRequest({ headers: { 'x-tenant-id': 'a', 'x-request-id': '222' } }),
		);

		expect(one.hash).toEqual(two.hash);
	});

	test('glob matches present headers, ignores unlisted ones', async () => {
		varyHeaders(['x-feature-*']);

		const on = await getCacheKey(feature('1'));
		const off = await getCacheKey(feature('0'));

		const withNoise = await getCacheKey(
			varyRequest({ headers: { 'x-feature-beta': '1', 'x-unrelated': 'z' } }),
		);

		expect(on.hash).not.toEqual(off.hash);
		expect(withNoise.hash).toEqual(on.hash);
	});

	test('trims whitespace the env array cast leaves around a name', async () => {
		varyHeaders([' x-tenant-id ']);

		const a = await getCacheKey(tenant('a'));
		const b = await getCacheKey(tenant('b'));

		// Without the trim the padded name matches no header → both null → one bucket.
		expect(a.hash).not.toEqual(b.hash);
	});

	test('a glob skips proxy/tracing headers but folds the rest', async () => {
		varyHeaders(['x-*']);

		const proxyA = await getCacheKey(
			varyRequest({ headers: { 'x-tenant-id': 'a', 'x-forwarded-for': '1.1.1.1' } }),
		);

		const proxyB = await getCacheKey(
			varyRequest({ headers: { 'x-tenant-id': 'a', 'x-forwarded-for': '2.2.2.2' } }),
		);

		// x-forwarded-for changed but is denied → same bucket (cache not disabled)
		expect(proxyA.hash).toEqual(proxyB.hash);

		// x-tenant-id is matched by the glob and not denied → still splits
		const tenantB = await getCacheKey(
			varyRequest({ headers: { 'x-tenant-id': 'b', 'x-forwarded-for': '1.1.1.1' } }),
		);

		expect(tenantB.hash).not.toEqual(proxyA.hash);
	});

	test('an exact proxy-header name overrides the glob denylist', async () => {
		varyHeaders(['x-forwarded-for']);

		const a = await getCacheKey(
			varyRequest({ headers: { 'x-forwarded-for': '1.1.1.1' } }),
		);

		const b = await getCacheKey(
			varyRequest({ headers: { 'x-forwarded-for': '2.2.2.2' } }),
		);

		expect(a.hash).not.toEqual(b.hash);
	});

	test('CACHE_VARY_REQUEST_HEADERS_EXCLUDED extends the glob denylist', async () => {
		vi.mocked(useEnv).mockReturnValue({
			CACHE_VARY_REQUEST_HEADERS: ['x-*'],
			CACHE_VARY_REQUEST_HEADERS_EXCLUDED: ['x-tenant-id'],
		});

		// x-tenant-id is matched by x-* but now excluded → no longer splits
		const a = await getCacheKey(tenant('a'));
		const b = await getCacheKey(tenant('b'));

		expect(a.hash).toEqual(b.hash);

		// a sibling the exclusion doesn't name still splits
		const featureOn = await getCacheKey(feature('1'));
		const featureOff = await getCacheKey(feature('0'));

		expect(featureOn.hash).not.toEqual(featureOff.hash);
	});
});
