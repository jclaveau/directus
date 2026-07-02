import { useEnv } from '@directus/env';

/**
 * Which cache consumers are active. `CACHE_ENABLED` is the master switch — the only thing that
 * creates the store — while `CACHE_TYPES` selects which layers use it: `api` for the HTTP response
 * cache (`cache.ts` middleware + `respond.ts`), `service` for the `ItemsService.readByQuery`
 * read-through. Default (`api,service`) enables both; drop one to run the other alone.
 */
export function isCacheTypeEnabled(type: 'api' | 'service'): boolean {
	const types = useEnv()['CACHE_TYPES'];
	return Array.isArray(types) && types.includes(type);
}
