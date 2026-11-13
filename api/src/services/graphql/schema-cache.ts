import { useEnv } from '@directus/env';
import { GraphQLSchema } from 'graphql';
import { LRUMap } from 'mnemonist';
import { AsyncLocalStorage } from 'node:async_hooks';
import { useBus } from '../../bus/index.js';
import type { GraphQLService } from './index.js';

const env = useEnv();
const bus = useBus();

export const cache = new LRUMap<string, GraphQLSchema | string>(Number(env['GRAPHQL_SCHEMA_CACHE_CAPACITY'] ?? 100));

bus.subscribe('schemaChanged', () => {
	cache.clear();
});

/**
 * The service of the request running a schema. A cached schema outlives the
 * request that built it, and its resolvers have to read and record through the
 * request running them, not through that first one.
 */
export const executingService = new AsyncLocalStorage<GraphQLService>();

/**
 * What a schema build hands its resolvers in place of `builder`: every access
 * goes to the service running the schema, or to `builder` when none is.
 *
 * Only reads and writes are forwarded: `in`, `Object.keys` or a spread still see
 * `builder`.
 */
export function followExecutingService(builder: GraphQLService): GraphQLService {
	return new Proxy(builder, {
		get(target, property) {
			const runningService = executingService.getStore() ?? target;
			const value = Reflect.get(runningService, property, runningService);

			// A method, bound so its `this` is the running service. An own field
			// that happens to be callable, like `knex`, is returned as is.
			if (typeof value === 'function' && !Object.hasOwn(runningService, property)) {
				return value.bind(runningService);
			}

			return value;
		},
		set(target, property, value) {
			const runningService = executingService.getStore() ?? target;

			return Reflect.set(runningService, property, value, runningService);
		},
	});
}
