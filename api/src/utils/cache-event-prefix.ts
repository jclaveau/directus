import url from 'url';

/**
 * The request's first path segment (`/items/articles?x=1` → `/items`), captured on
 * every hit/miss so the cache page can group the timeseries by endpoint. A miss
 * never writes a descriptor, so this is the only path handle it carries. Falls back
 * to `/` when there's no segment.
 */
export function cacheEventPrefix(originalUrl: string): string {
	const path = url.parse(originalUrl).pathname ?? '';
	const [segment] = path.split('/').filter(Boolean);

	return segment
		? `/${segment}`
		: '/';
}
