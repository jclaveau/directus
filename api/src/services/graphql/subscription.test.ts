import { oneLine } from '@directus/utils';
import type { GraphQLResolveInfo } from 'graphql';
import { describe, expect, test, vi } from 'vitest';

vi.mock('../../bus/index.js', () => ({ useBus: () => ({ subscribe: vi.fn() }) }));
vi.mock('../../utils/get-schema.js', () => ({ getSchema: vi.fn() }));
vi.mock('../../websocket/utils/items.js', () => ({ getPayload: vi.fn() }));

vi.mock('./schema/parse-query.js', () => {
	return { getQuery: vi.fn(async () => ({ fields: ['id'] })) };
});

import type { GraphQLService } from './index.js';
import { executingService } from './schema-cache.js';
import { getQuery } from './schema/parse-query.js';
import { createSubscriptionGenerator } from './subscription.js';

describe('createSubscriptionGenerator', () => {
	test(oneLine`
		a subscription reads its fields as the service of the request that
		subscribed, not as the one that built the schema
	`, async () => {
		const builder = { schema: 'schema of the builder', accountability: null };
		const runner = { schema: 'schema of the runner', accountability: null };

		const subscribe = createSubscriptionGenerator(
			builder as unknown as GraphQLService,
			'articles_mutated',
		);

		const events = executingService.run(
			runner as unknown as GraphQLService,
			() => {
				return subscribe(null, null, null, {
					fieldNodes: [{ arguments: [], selectionSet: { selections: [] } }],
					variableValues: {},
				} as unknown as GraphQLResolveInfo);
			},
		);

		// Waits on the first message forever, once it has read its fields.
		void events.next();

		await vi.waitFor(() => {
			expect(getQuery).toHaveBeenCalledWith(
				{},
				'schema of the runner',
				[],
				{},
				null,
			);
		});
	});

	test(oneLine`
		falls back to the service it was built with when no request runs it
	`, async () => {
		const builder = { schema: 'schema of the builder', accountability: null };

		const subscribe = createSubscriptionGenerator(
			builder as unknown as GraphQLService,
			'articles_mutated',
		);

		void subscribe(null, null, null, {
			fieldNodes: [{ arguments: [], selectionSet: { selections: [] } }],
			variableValues: {},
		} as unknown as GraphQLResolveInfo).next();

		await vi.waitFor(() => {
			expect(getQuery).toHaveBeenCalledWith(
				{},
				'schema of the builder',
				[],
				{},
				null,
			);
		});
	});
});
