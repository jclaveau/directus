import { useEnv } from '@directus/env';
import type { Knex } from 'knex';
import { useBus } from './bus/index.js';
import getDatabase from './database/index.js';
import { redisConfigAvailable } from './redis/index.js';
import { getMilliseconds } from './utils/get-milliseconds.js';

const messenger = useBus();

export type CacheQueryShape = 'aggregate' | 'item' | 'list';

export interface CacheTtlRule {
	path: string; // endpoint prefix, e.g. '/items/articles'
	method: string; // 'GET' | 'SEARCH' | '*'
	queryShape: CacheQueryShape | '*';
	ttl: string | number; // human ('1h') or ms
	sort: number; // first-match order
}

export interface CacheTtlDescriptor {
	path: string;
	method: string;
	queryShape: CacheQueryShape;
}

// null = not yet loaded from the table; [] = loaded, no rules.
let cachedRules: CacheTtlRule[] | null = null;
let rulesSubscribed = false;

interface CacheTtlRulesMessage {
	reload: true;
}

if (redisConfigAvailable() && !rulesSubscribed) {
	rulesSubscribed = true;

	// Drop the in-memory copy so the next resolve reloads cluster-wide — same
	// live-flip pattern as schemaChanged / cacheStatsToggled.
	messenger.subscribe<CacheTtlRulesMessage>('cacheTtlRulesChanged', () => {
		cachedRules = null;
	});
}

export function classifyCacheQueryShape(sanitizedQuery: Record<string, unknown> | undefined): CacheQueryShape {
	if (sanitizedQuery?.['aggregate']) return 'aggregate';
	// A collection read carries list controls; a single-item read does not.
	if (sanitizedQuery?.['filter'] || sanitizedQuery?.['search'] || sanitizedQuery?.['limit']) return 'list';
	return 'item';
}

async function loadCacheTtlRules(knex: Knex): Promise<CacheTtlRule[]> {
	const rows = await knex
		.select('path', 'method', 'query_shape', 'ttl', 'sort')
		.from('directus_cache_ttl_rules')
		.orderBy('sort', 'asc');

	return rows.map((row) => ({
		path: row.path,
		method: row.method,
		queryShape: row.query_shape,
		ttl: row.ttl,
		sort: row.sort,
	}));
}

function matchesCacheTtlRule(rule: CacheTtlRule, descriptor: CacheTtlDescriptor): boolean {
	if (rule.method !== '*' && rule.method.toLowerCase() !== descriptor.method.toLowerCase()) {
		return false;
	}

	if (rule.queryShape !== '*' && rule.queryShape !== descriptor.queryShape) {
		return false;
	}

	return descriptor.path === rule.path || descriptor.path.startsWith(rule.path);
}

/**
 * Resolve the TTL (ms) for a to-be-cached response.
 *
 * - First matching rule by `sort` wins; no match falls back to the global CACHE_TTL.
 * - Rules load lazily into memory and stay until a bus 'cacheTtlRulesChanged' clears them,
 *   so the hot path never touches the DB once warm.
 */
export async function resolveCacheTtl(descriptor: CacheTtlDescriptor): Promise<number | undefined> {
	if (cachedRules === null) {
		try {
			cachedRules = await loadCacheTtlRules(getDatabase());
		}
		catch {
			// Table absent (pre-migration) or read failed: behave as no rules.
			cachedRules = [];
		}
	}

	const match = cachedRules.find((rule) => matchesCacheTtlRule(rule, descriptor));

	return getMilliseconds(match ? match.ttl : useEnv()['CACHE_TTL'], undefined);
}

/** Persist the full rule set and flip every node live. */
export async function setCacheTtlRules(knex: Knex, rules: CacheTtlRule[]): Promise<void> {
	await knex.transaction(async (trx) => {
		await trx('directus_cache_ttl_rules').del();

		if (rules.length) {
			await trx('directus_cache_ttl_rules').insert(
				rules.map((rule, index) => ({
					path: rule.path,
					method: rule.method,
					query_shape: rule.queryShape,
					ttl: String(rule.ttl),
					sort: rule.sort ?? index,
				})),
			);
		}
	});

	cachedRules = null;
	messenger.publish<CacheTtlRulesMessage>('cacheTtlRulesChanged', { reload: true });
}
