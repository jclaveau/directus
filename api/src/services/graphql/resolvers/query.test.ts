import { oneLine } from '@directus/utils';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../versions.js', () => {
	return {
		VersionsService: class {
			async getVersionSaves() {
				return null;
			}
		},
	};
});

vi.mock('../schema/parse-args.js', () => {
	return { parseArgs: vi.fn(() => ({ id: '1', version: 'draft' })) };
});

vi.mock('../schema/parse-query.js', () => ({ getQuery: vi.fn(async () => ({})) }));
vi.mock('../utils/aggregate-query.js', () => ({ getAggregateQuery: vi.fn() }));

vi.mock('../utils/replace-fragments.js', () => {
	return { replaceFragmentsInSelections: vi.fn(() => [{}]) };
});

import type { GraphQLService } from '../index.js';
import { resolveQuery } from './query.js';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('resolveQuery scoped cache fingerprints', () => {
	test(oneLine`
		a version read adds the bare directus_versions fingerprint, so a write to
		the version purges the cached /graphql response
	`, async () => {
		const gql = {
			scope: 'items',
			schema: {
				collections: { articles: { primary: 'id', singleton: false } },
			},
			accountability: null,
			read: vi.fn(async () => [{ id: '1' }]),
			scopedCacheFingerprints: [],
		} as unknown as GraphQLService;

		await resolveQuery(gql, {
			fieldName: 'articles_by_version',
			fieldNodes: [{ arguments: [] }],
			fragments: {},
			variableValues: {},
		} as any);

		expect(gql.scopedCacheFingerprints).toEqual([
			{ collection: 'directus_versions' },
		]);
	});
});
