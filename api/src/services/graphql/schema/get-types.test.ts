import { SchemaComposer } from 'graphql-compose';
import { describe, expect, test, vi } from 'vitest';

// graphql-compose runs on the CommonJS build of graphql.
vi.mock('graphql', async () => {
	const { createRequire } = await import('node:module');

	return createRequire(import.meta.url)('graphql');
});

vi.mock('../../../bus/index.js', () => ({ useBus: () => ({ subscribe: vi.fn() }) }));
vi.mock('../index.js', () => ({ GraphQLService: vi.fn() }));
vi.mock('../resolvers/system.js', () => ({ injectSystemResolvers: vi.fn() }));
vi.mock('./read.js', () => ({ getReadableTypes: vi.fn() }));
vi.mock('./write.js', () => ({ getWritableTypes: vi.fn() }));

import type { Schema } from './index.js';
import { getTypes } from './get-types.js';

describe('getTypes', () => {
	// Written through raw knex, never purged: a cached /graphql/system read
	// would serve them stale (#642).
	test('system scope gives the cache telemetry collections no type', () => {
		const { CollectionTypes } = getTypes(
			new SchemaComposer(),
			'system',
			{
				read: {
					collections: {
						directus_cache_stats_descriptors: {
							collection: 'directus_cache_stats_descriptors',
							primary: 'id',
							fields: { id: { field: 'id', type: 'integer', special: [] } },
						},
						directus_cache_stats_events: {
							collection: 'directus_cache_stats_events',
							primary: 'id',
							fields: { id: { field: 'id', type: 'integer', special: [] } },
						},
						directus_cache_stats_anomalies: {
							collection: 'directus_cache_stats_anomalies',
							primary: 'id',
							fields: { id: { field: 'id', type: 'integer', special: [] } },
						},
						directus_cache_stats_config_events: {
							collection: 'directus_cache_stats_config_events',
							primary: 'id',
							fields: { id: { field: 'id', type: 'integer', special: [] } },
						},
						directus_cache_stats_purges: {
							collection: 'directus_cache_stats_purges',
							primary: 'id',
							fields: { id: { field: 'id', type: 'integer', special: [] } },
						},
						directus_cache_stats_scoped_entry_pins: {
							collection: 'directus_cache_stats_scoped_entry_pins',
							primary: 'id',
							fields: { id: { field: 'id', type: 'integer', special: [] } },
						},
						directus_cache_stats_scoped_purge_pins: {
							collection: 'directus_cache_stats_scoped_purge_pins',
							primary: 'id',
							fields: { id: { field: 'id', type: 'integer', special: [] } },
						},
						directus_cache_audits: {
							collection: 'directus_cache_audits',
							primary: 'id',
							fields: { id: { field: 'id', type: 'integer', special: [] } },
						},
						directus_cache_audit_findings: {
							collection: 'directus_cache_audit_findings',
							primary: 'id',
							fields: { id: { field: 'id', type: 'integer', special: [] } },
						},
						directus_users: {
							collection: 'directus_users',
							primary: 'id',
							fields: { id: { field: 'id', type: 'uuid', special: [] } },
						},
					},
					relations: [],
				},
			} as unknown as Schema,
			{ read: {} } as never,
			'read',
		);

		expect(Object.keys(CollectionTypes)).toEqual(['directus_users']);
	});
});
