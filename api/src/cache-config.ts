import { useEnv } from '@directus/env';
import { useBus } from './bus/index.js';

/**
 * The live global cache-TTL override, persisted in `directus_settings.cache_ttl`
 * and mirrored here so the hot path reads a module variable, never a per-request DB
 * query (same shape as `cacheStatsActive()`). `null` means "no override" → the
 * reader falls back to env `CACHE_TTL`.
 *
 * Seeded from settings at boot; kept live across every node by the
 * `cacheConfigChanged` bus channel, which the settings PATCH publishes (see
 * `SettingsService`). A node that missed the publish re-seeds correctly on its next
 * boot, so the DB row stays the durable source of truth.
 */
let cacheTtlOverride: string | null = null;

const CONFIG_CHANGED_CHANNEL = 'cacheConfigChanged';

interface CacheConfigChange {
	ttl: string | null;
}

/**
 * The TTL value in force — the settings override when set, else env `CACHE_TTL`.
 * Returned raw (a duration string, or undefined when neither is set) for
 * `getMilliseconds` to parse at the consuming site, exactly as env was read before.
 */
export function resolvedCacheTtl(): unknown {
	return cacheTtlOverride ?? useEnv()['CACHE_TTL'];
}

// An empty/whitespace string is "unset", not the number 0 — normalise it to null so
// the reader falls through to env rather than parsing `''` (which coerces to NaN).
function normaliseTtl(value: unknown): string | null {
	return typeof value === 'string' && value.trim() !== ''
		? value
		: null;
}

/** Re-read the durable override from `directus_settings` into the mirror. */
export async function refreshCacheTtlOverride(): Promise<void> {
	// Imported lazily so the hot-path `resolvedCacheTtl` consumers (respond/cache/
	// scoped-cache) don't statically pull the whole database dialect graph.
	const { default: getDatabase } = await import('./database/index.js');

	const row = await getDatabase()
		.select('cache_ttl')
		.from('directus_settings')
		.first();

	cacheTtlOverride = normaliseTtl(row?.cache_ttl);
}

/**
 * Announce a TTL change to every node and apply it here now. The peers pick it up
 * off the bus; a booting node that missed the message re-seeds from settings via
 * `refreshCacheTtlOverride`.
 */
export function publishCacheConfigChanged(ttl: unknown): void {
	const normalised = normaliseTtl(ttl);
	cacheTtlOverride = normalised;
	useBus().publish<CacheConfigChange>(CONFIG_CHANGED_CHANNEL, { ttl: normalised });
}

/**
 * Seed the override from settings and subscribe to live changes. Called
 * unconditionally at boot (unlike the cache-stats gate) so the override works even
 * when stats/Redis are off — with no Redis the bus is a same-process emitter, which
 * still delivers this node's own publishes.
 */
export async function initCacheConfig(): Promise<void> {
	// Best-effort seed: a not-yet-migrated or unreadable settings table must not crash
	// boot — the override just stays unset (env `CACHE_TTL`) until the next change.
	try {
		await refreshCacheTtlOverride();
	}
	catch {
		// leave cacheTtlOverride at null → resolvedCacheTtl falls back to env
	}

	useBus().subscribe<CacheConfigChange>(CONFIG_CHANGED_CHANNEL, ({ ttl }) => {
		cacheTtlOverride = normaliseTtl(ttl);
	});

	// Announcing from the action rather than from `SettingsService` is what makes the
	// broadcast unconditional: every write to the singleton emits it, whatever wrote
	// it — the cache page's PATCH, a config-sync import, a seed script. Announcing
	// from the service instead left a bypassing writer's new value durable but
	// unannounced, so each node kept serving its stale TTL until it happened to
	// restart. Imported lazily for the same reason as the database above.
	const { default: emitter } = await import('./emitter.js');
	const { recordCacheConfigEvent } = await import('./cache-events.js');

	// The per-row event, not the grouped one: this reads a single row's fields, and
	// a singleton only ever has the one.
	emitter.onAction('settings.update.one', ({ payload }) => {
		if (!payload || 'cache_ttl' in payload === false) {
			return;
		}

		publishCacheConfigChanged(payload['cache_ttl']);

		// The marker is what explains a step in the TTL series, so it has to cover the
		// same writers as the broadcast: a reset that leaves no marker is a change with
		// no visible cause, which is how a production one stayed invisible until
		// `directus_revisions` was read by hand (#342). Best-effort — a chart
		// annotation must never fail a settings save.
		void recordCacheConfigEvent('ttl_change', payload['cache_ttl']).catch(() => {});
	});
}
