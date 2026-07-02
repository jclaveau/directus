import type { Accountability, Query } from '@directus/types';
import type { Request } from 'express';
import hash from 'object-hash';
import url from 'url';
import getDatabase from '../database/index.js';
import { fetchPoliciesIpAccess } from '../permissions/modules/fetch-policies-ip-access/fetch-policies-ip-access.js';
import { getGraphqlQueryAndVariables } from './get-graphql-query-and-variables.js';
import { version } from 'directus/version';
import { ipInNetworks } from './ip-in-networks.js';

// The request IP only belongs in a cache key when a matching policy `ip_access` filter makes the
// result IP-dependent — otherwise it would fragment the cache per-client for no reason.
async function ipAffectsResult(accountability: Accountability | null): Promise<boolean> {
	if (!accountability?.ip) {
		return false;
	}

	const ipFilters = await fetchPoliciesIpAccess(accountability, getDatabase());

	return (
		ipFilters.length > 0 &&
		ipFilters.some((networks) => ipInNetworks(accountability.ip!, networks))
	);
}

export async function getCacheKey(req: Request) {
	const path = url.parse(req.originalUrl).pathname;
	const isGraphQl = path?.startsWith('/graphql');

	const info = {
		version,
		user: req.accountability?.user || null,
		path,
		query: isGraphQl ? getGraphqlQueryAndVariables(req) : req.sanitizedQuery,
		...((await ipAffectsResult(req.accountability ?? null)) && {
			ip: req.accountability!.ip,
		}),
	};

	const key = hash(info);
	return key;
}

/**
 * Cache key for the service-level read-through in `ItemsService.readByQuery`, built from the same
 * signals as the HTTP key (`getCacheKey`) minus the request URL: a programmatic caller has no
 * `path`, so the collection stands in for it. Deliberately its OWN namespace — a service-cached
 * read and the HTTP response cache hold different shapes (raw items vs shaped response), so they
 * must not collide on one key.
 */
export async function getReadThroughCacheKey(
	collection: string,
	query: Query,
	accountability: Accountability | null,
): Promise<string> {
	const info = {
		version,
		user: accountability?.user || null,
		collection,
		query,
		...((await ipAffectsResult(accountability)) && { ip: accountability!.ip }),
	};

	return hash(info);
}
