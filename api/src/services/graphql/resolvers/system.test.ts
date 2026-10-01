import { oneLine } from '@directus/utils';
import { SchemaComposer } from 'graphql-compose';
import knex from 'knex';
import { MockClient } from 'knex-mock-client';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { withMeta } from '../../../utils/read-meta.js';

// graphql-compose requires graphql's CommonJS build while vite hands the source
// the ESM one, so its instanceof checks refuse every type system.ts builds.
vi.mock('graphql', async () => {
	const { createRequire } = await import('node:module');

	return createRequire(import.meta.url)('graphql');
});

vi.mock('../../../database/index.js', () => ({ default: vi.fn() }));
vi.mock('../../../utils/get-service.js', () => ({ getService: vi.fn() }));
vi.mock('../schema/index.js', () => ({ generateSchema: vi.fn() }));
vi.mock('../schema/parse-query.js', () => ({ getQuery: vi.fn(async () => ({})) }));
vi.mock('./system-admin.js', () => ({ resolveSystemAdmin: vi.fn() }));
vi.mock('./system-global.js', () => ({ globalResolvers: vi.fn() }));
vi.mock('../../collections.js', () => ({ CollectionsService: class {} }));
vi.mock('../../fields.js', () => ({ FieldsService: class {} }));
vi.mock('../../files.js', () => ({ FilesService: class {} }));
vi.mock('../../relations.js', () => ({ RelationsService: class {} }));
vi.mock('../../roles.js', () => ({ RolesService: class {} }));
vi.mock('../../server.js', () => ({ ServerService: class {} }));
vi.mock('../../specifications.js', () => ({ SpecificationService: class {} }));

vi.mock('../../users.js', () => {
	return {
		UsersService: class {
			async readOne() {
				return {};
			}
		},
	};
});

import { UsersService } from '../../users.js';
import { GraphQLService } from '../index.js';
import { injectSystemResolvers } from './system.js';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('system resolvers feed the request aggregate', () => {
	test(oneLine`
		users_me hands its read's fingerprints to the aggregate, so a write to the
		user purges the cached /graphql/system response
	`, async () => {
		const gql = new GraphQLService({
			knex: knex({ client: MockClient }),
			schema: { collections: {} } as any,
			accountability: { user: 'user-1', role: null, roles: [] } as any,
			scope: 'system',
		});

		const schemaComposer = new SchemaComposer();

		injectSystemResolvers(
			gql,
			schemaComposer,
			{
				CreateCollectionTypes: {},
				ReadCollectionTypes: {
					directus_users: schemaComposer.createObjectTC({
						name: 'directus_users',
						fields: { id: 'ID' },
					}),
				},
				UpdateCollectionTypes: {},
				DeleteCollectionTypes: {},
			},
			{
				read: { collections: { directus_users: {} } },
				create: { collections: {} },
				update: { collections: {} },
				delete: { collections: {} },
			} as any,
		);

		vi.spyOn(UsersService.prototype, 'readOne').mockResolvedValue(
			withMeta(
				{ id: 'user-1' },
				{ scopedCacheFingerprints: [{ collection: 'directus_users' }] },
			),
		);

		await schemaComposer.Query.getFieldConfig('users_me').resolve!(
			undefined,
			{},
			{},
			{ fieldNodes: [], fragments: {}, variableValues: {} } as any,
		);

		expect(gql.scopedCacheFingerprints).toEqual([
			{ collection: 'directus_users' },
		]);

		expect(gql.unpinnedRootRead).toBe(false);
	});

	test(oneLine`
		server_ping returns no read meta, so the response is left unpinned rather
		than filed under the other roots' fingerprints alone
	`, async () => {
		const gql = new GraphQLService({
			knex: knex({ client: MockClient }),
			schema: { collections: {} } as any,
			accountability: null,
			scope: 'system',
		});

		const schemaComposer = new SchemaComposer();

		injectSystemResolvers(
			gql,
			schemaComposer,
			{
				CreateCollectionTypes: {},
				ReadCollectionTypes: {},
				UpdateCollectionTypes: {},
				DeleteCollectionTypes: {},
			},
			{
				read: { collections: {} },
				create: { collections: {} },
				update: { collections: {} },
				delete: { collections: {} },
			} as any,
		);

		await schemaComposer.Query.getFieldConfig('server_ping').resolve!(
			undefined,
			{},
			{},
			{} as any,
		);

		expect(gql.unpinnedRootRead).toBe(true);
	});
});
