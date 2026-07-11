export interface CacheEntry {
	key: string;
	path: string;
	method: string;
	user: { id: string; email: string | null } | null;
	query: string;
	url: string;
	createdAt: number;
	expiresAt: number | null;
	lastHitAt: number | null;
	size: number;
	hits: number;
}

export interface EndpointGroup {
	path: string;
	entries: CacheEntry[];
	totalHits: number;
	totalSize: number;
}

// Directus system surface: the dedicated system routes + reads of a `directus_*`
// collection (and the system GraphQL schema). Everything else is app data.
const SYSTEM_SEGMENTS = new Set(
	(
		'server schema auth users roles permissions policies files folders '
		+ 'fields collections relations activity revisions presets settings flows '
		+ 'operations extensions utils translations dashboards panels notifications '
		+ 'shares comments versions metrics assets'
	).split(' '),
);

export function isSystemPath(path: string): boolean {
	const segments = path.split('/').filter(Boolean);
	const head = segments[0] ?? '';

	if (head === 'items') {
		return (segments[1] ?? '').startsWith('directus_');
	}

	if (head === 'graphql') {
		return path.startsWith('/graphql/system');
	}

	return SYSTEM_SEGMENTS.has(head);
}

export function formatSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}

	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}

	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Coarse s/m/h/d bucket for a second count (used by age + expiry).
function coarse(seconds: number): string {
	if (seconds < 60) {
		return `${Math.max(seconds, 0)}s`;
	}

	if (seconds < 3600) {
		return `${Math.round(seconds / 60)}m`;
	}

	if (seconds < 86400) {
		return `${Math.round(seconds / 3600)}h`;
	}

	return `${Math.round(seconds / 86400)}d`;
}

export function formatAge(now: number, timestamp: number): string {
	return coarse(Math.round((now - timestamp) / 1000));
}

export function formatExpiry(
	now: number,
	expiresAt: number | null,
	expiredLabel: string,
): string {
	if (expiresAt === null) {
		return '∞';
	}

	const seconds = Math.round((expiresAt - now) / 1000);

	if (seconds <= 0) {
		return expiredLabel;
	}

	return coarse(seconds);
}

export function formatLastHit(
	now: number,
	lastHitAt: number | null,
	neverLabel: string,
): string {
	if (lastHitAt === null) {
		return neverLabel;
	}

	return formatAge(now, lastHitAt);
}

export function formatUser(
	user: { email: string | null } | null,
	publicLabel: string,
): string {
	return user?.email ?? publicLabel;
}

export function shortKey(key: string): string {
	return key.length > 12
		? `${key.slice(0, 12)}…`
		: key;
}

export function formatQuery(query: string): string {
	if (!query || query === '{}') {
		return '—';
	}

	return query;
}

// Bucket entries by endpoint path, newest-hottest first.
export function buildGroups(entries: CacheEntry[]): EndpointGroup[] {
	const byPath = new Map<string, CacheEntry[]>();

	for (const entry of entries) {
		const bucket = byPath.get(entry.path) ?? [];
		bucket.push(entry);
		byPath.set(entry.path, bucket);
	}

	const result: EndpointGroup[] = [];

	for (const [path, groupEntries] of byPath) {
		result.push({
			path,
			entries: groupEntries,
			totalHits: groupEntries.reduce((sum, entry) => sum + entry.hits, 0),
			totalSize: groupEntries.reduce((sum, entry) => sum + entry.size, 0),
		});
	}

	return result.sort((a, b) => b.totalHits - a.totalHits);
}
