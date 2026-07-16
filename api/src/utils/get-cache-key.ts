import { useEnv } from '@directus/env';
import type { Request } from 'express';
import hash from 'object-hash';
import url from 'url';
import getDatabase from '../database/index.js';
import { fetchPoliciesIpAccess } from '../permissions/modules/fetch-policies-ip-access/fetch-policies-ip-access.js';
import { getGraphqlQueryAndVariables } from './get-graphql-query-and-variables.js';
import { version } from 'directus/version';
import { ipInNetworks } from './ip-in-networks.js';

// Canonicalize nested object key order so the readable key below matches `object-hash`'s
// order-independence — two equivalent queries that differ only in key order stay one entry.
function sortNestedKeys(_key: string, value: unknown): unknown {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		const entries = Object.entries(value as Record<string, unknown>);
		return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
	}

	return value;
}

export interface CacheKey {
	// Redis key: readable descriptor (CACHE_KEY_HASH_ENABLED=false), else the hash.
	key: string;
	// Fixed-length stats identity (object-hash of the info): stats tables key by
	// this, so a readable Redis key can't overflow their 255-char column.
	hash: string;
}

export async function getCacheKey(req: Request): Promise<CacheKey> {
	const path = url.parse(req.originalUrl).pathname;
	const isGraphQl = path?.startsWith('/graphql');

	let includeIp = false;

	if (req.accountability && req.accountability.ip) {
		// Check if the IP influences the result of the request, that can be the case if some policies have an ip_access
		// filter and the request IP matches any of those filters
		const ipFilters = await fetchPoliciesIpAccess(req.accountability, getDatabase());
		includeIp = ipFilters.length > 0 && ipFilters.some((networks) => ipInNetworks(req.accountability!.ip!, networks));
	}

	const info = {
		version,
		user: req.accountability?.user || null,
		path,
		query: isGraphQl ? getGraphqlQueryAndVariables(req) : req.sanitizedQuery,
		...(includeIp && { ip: req.accountability!.ip }),
	};

	const digest = hash(info);

	// CACHE_KEY_HASH_ENABLED=false makes the Redis key the readable descriptor (a dev
	// sees which request an entry is); the stats identity stays the fixed digest.
	const key = useEnv()['CACHE_KEY_HASH_ENABLED'] === false
		? JSON.stringify(info, sortNestedKeys)
		: digest;

	return { key, hash: digest };
}
