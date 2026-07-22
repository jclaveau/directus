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

// Highest-q language from Accept-Language, region-stripped and lowercased
// (`fr-FR,fr;q=0.9,en` → `fr`). null when the header is absent or only `*`, so
// header-less callers keep the language-agnostic key — no fragmentation, and no key
// change for the many installs that don't localize. Parsed off the header directly
// so the key stays a pure function of req (no dependency on express's negotiator).
function normalizePrimaryLanguage(req: Request): string | null {
	const header = req.headers?.['accept-language'];

	if (typeof header !== 'string') {
		return null;
	}

	let bestTag: string | null = null;
	let bestQuality = 0;

	for (const entry of header.split(',')) {
		const [rawTag, ...params] = entry.trim().split(';');
		const tag = rawTag?.trim();

		if (!tag || tag === '*') {
			continue;
		}

		const qParam = params.find((param) => param.trim().startsWith('q='));

		const quality = qParam
			? Number.parseFloat(qParam.split('=')[1] ?? '')
			: 1;

		if (!Number.isNaN(quality) && quality > bestQuality) {
			bestQuality = quality;
			bestTag = tag;
		}
	}

	return bestTag
		? bestTag.split('-')[0]!.toLowerCase()
		: null;
}

// Normalize a CACHE_VARY_* list off the env. The array cast keeps whitespace around
// comma-separated values (`json, csv` → `[' csv']`) and can carry blanks/dupes, so
// trim + drop empties + dedupe. Order is PRESERVED, not sorted: for content types it
// must mirror the endpoint's own req.accepts() priority (the first type is what a
// `*/*` caller gets), so sorting would bucket those callers to the wrong format.
function varyList(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return [...new Set(value.map((entry) => String(entry).trim()).filter(Boolean))];
}

// undefined when CACHE_VARY_CONTENT_TYPES is unset (dimension omitted from the key
// entirely); else the negotiated type from the declared set, or null when the
// caller accepts none of them.
function negotiateContentType(
	req: Request,
	types: string[],
): string | null | undefined {
	if (types.length === 0) {
		return undefined;
	}

	return req.accepts(types) || null;
}

// A configured header's value, arrays (repeated headers) joined; null when absent so
// presence/absence stays a stable, distinct key dimension.
function varyHeaderValue(raw: string | string[] | undefined): string | null {
	if (raw === undefined) {
		return null;
	}

	return Array.isArray(raw)
		? raw.join(',')
		: raw;
}

// Anchor a header glob (`x-tenant-*`) as a regex; consecutive `*` collapsed so the
// pattern stays linear against attacker-supplied header names.
function varyHeaderPattern(pattern: string): RegExp {
	const escaped = pattern
		.replace(/\*+/g, '*')
		.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
		.replace(/\*/g, '.*');

	return new RegExp(`^${escaped}$`);
}

// undefined when CACHE_VARY_REQUEST_HEADERS is unset (dimension omitted). Exact
// names fold to their value (or null if absent); glob patterns fold every present
// header they match. Names lowercased to match Node's header keys.
function resolveVaryHeaders(
	req: Request,
	patterns: string[],
): Record<string, string | null> | undefined {
	if (patterns.length === 0) {
		return undefined;
	}

	const resolved: Record<string, string | null> = {};

	for (const pattern of patterns) {
		const name = pattern.toLowerCase();

		if (!name.includes('*')) {
			resolved[name] = varyHeaderValue(req.headers[name]);
			continue;
		}

		const regex = varyHeaderPattern(name);

		for (const header of Object.keys(req.headers)) {
			if (regex.test(header)) {
				resolved[header] = varyHeaderValue(req.headers[header]);
			}
		}
	}

	return resolved;
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

	const env = useEnv();

	const info: Record<string, unknown> = {
		version,
		user: req.accountability?.user || null,
		path,
		query: isGraphQl ? getGraphqlQueryAndVariables(req) : req.sanitizedQuery,
		...(includeIp && { ip: req.accountability!.ip }),
	};

	// A hook that localizes the body by Accept-Language would otherwise serve the
	// first caller's language to everyone. Fold the normalized primary tag only when
	// the caller expressed one — header-less requests keep the original key.
	const language = normalizePrimaryLanguage(req);

	if (language !== null) {
		info['language'] = language;
	}

	// A custom endpoint that content-negotiates (csv vs json by Accept) varies its
	// body; without the served type in the key the first caller's format is served to
	// all. The list (default json,csv,yaml) is what collapses the many raw Accept
	// strings into a small bucket set.
	const contentType = negotiateContentType(
		req,
		varyList(env['CACHE_VARY_CONTENT_TYPES']),
	);

	if (contentType !== undefined) {
		info['contentType'] = contentType;
	}

	// Opt-in: custom/tenant/feature-flag request headers a hook reshapes the body
	// from. Arbitrary headers can't be always-folded — proxy-injected ones like
	// x-request-id are unique per request and would disable the cache — so the admin
	// names exactly the headers (or globs) their hooks read.
	const varyHeaders = resolveVaryHeaders(
		req,
		varyList(env['CACHE_VARY_REQUEST_HEADERS']),
	);

	if (varyHeaders !== undefined) {
		info['headers'] = varyHeaders;
	}

	const digest = hash(info);

	// CACHE_KEY_HASH_ENABLED=false makes the Redis key the readable descriptor (a dev
	// sees which request an entry is); the stats identity stays the fixed digest.
	const key = env['CACHE_KEY_HASH_ENABLED'] === false
		? JSON.stringify(info, sortNestedKeys)
		: digest;

	return { key, hash: digest };
}
