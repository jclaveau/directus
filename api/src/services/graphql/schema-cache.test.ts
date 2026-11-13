import { oneLine } from '@directus/utils';
import { describe, expect, test, vi } from 'vitest';

vi.mock('../../bus/index.js', () => ({ useBus: () => ({ subscribe: vi.fn() }) }));

import type { GraphQLService } from './index.js';
import { executingService, followExecutingService } from './schema-cache.js';

describe('followExecutingService', () => {
	test(oneLine`
		a resolver of a cached schema records into the request running it, not
		into the request that built the schema
	`, () => {
		const builder = {
			scopedCacheTags: [] as unknown[],
			recordTag(tag: unknown) {
				this.scopedCacheTags.push(tag);
			},
		};

		const runner = { ...builder, scopedCacheTags: [] as unknown[] };

		const resolverService = followExecutingService(
			builder as unknown as GraphQLService,
		);

		executingService.run(runner as unknown as GraphQLService, () => {
			(resolverService as unknown as typeof builder)
				.recordTag({ collection: 'articles' });
		});

		expect(runner.scopedCacheTags).toEqual([{ collection: 'articles' }]);
		expect(builder.scopedCacheTags).toEqual([]);
	});

	test(oneLine`
		a write through it lands on the request running the schema
	`, () => {
		const builder = { scope: 'items' };
		const runner = { scope: 'items' };

		const resolverService = followExecutingService(
			builder as unknown as GraphQLService,
		);

		executingService.run(runner as unknown as GraphQLService, () => {
			resolverService.scope = 'system';
		});

		expect(runner).toEqual({ scope: 'system' });
		expect(builder).toEqual({ scope: 'items' });
	});

	test(oneLine`
		a method of the service runs with the running service as its \`this\`, not
		the proxy
	`, () => {
		class Service {
			runningService() {
				return this;
			}
		}

		const builder = new Service();
		const runner = new Service();

		const resolverService = followExecutingService(
			builder as unknown as GraphQLService,
		);

		const receiver = executingService.run(
			runner as unknown as GraphQLService,
			() => (resolverService as unknown as Service).runningService(),
		);

		expect(receiver).toBe(runner);
	});

	test(oneLine`
		an own callable field, like knex, is returned as is, with its properties
	`, () => {
		const knex = Object.assign(() => undefined, { client: 'pg' });
		const builder = { knex };

		const resolverService = followExecutingService(
			builder as unknown as GraphQLService,
		);

		expect(resolverService.knex).toBe(knex);
	});

	test(oneLine`
		falls back to the builder when no request runs the schema
	`, () => {
		const builder = { accountability: { user: 'builder' } };

		const resolverService = followExecutingService(
			builder as unknown as GraphQLService,
		);

		expect(resolverService.accountability).toEqual({ user: 'builder' });
	});
});
