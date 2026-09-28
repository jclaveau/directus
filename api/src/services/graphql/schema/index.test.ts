import { oneLine } from '@directus/utils';
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

vi.mock('../utils/sanitize-gql-schema.js', () => {
	return {
		sanitizeGraphqlSchema: vi.fn(() => {
			throw new Error('build stopped');
		}),
	};
});

import type { GraphQLService } from '../index.js';
import { cache, executingService } from '../schema-cache.js';
import { sanitizeGraphqlSchema } from '../utils/sanitize-gql-schema.js';
import { generateSchema } from './index.js';

describe('generateSchema', () => {
	test(oneLine`
		serves the schema cached under the builder's scope, type, role and user
	`, async () => {
		cache.set('items_schema_role-a_user-a', 'schema of user-a');

		const schema = await generateSchema({
			scope: 'items',
			accountability: { role: 'role-a', user: 'user-a' },
		} as unknown as GraphQLService);

		expect(schema).toBe('schema of user-a');
	});

	test(oneLine`
		builds as the builder, even when asked by a resolver of a request running
		another service
	`, async () => {
		const builder = {
			scope: 'items',
			accountability: null,
			schema: 'schema of the builder',
		};

		const runner = { schema: 'schema of the runner' };

		await expect(executingService.run(
			runner as unknown as GraphQLService,
			() => generateSchema(builder as unknown as GraphQLService),
		)).rejects.toThrow('build stopped');

		expect(sanitizeGraphqlSchema).toHaveBeenCalledWith('schema of the builder');
	});
});
