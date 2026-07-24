import type {
	AbstractServiceOptions,
	Item,
	MutationOptions,
	PrimaryKey,
} from '@directus/types';
import { InvalidPayloadError } from '@directus/errors';
import { publishCacheConfigChanged } from '../cache-config.js';
import { recordCacheConfigEvent } from '../cache-events.js';
import { isPositiveDuration } from '../utils/get-milliseconds.js';
import { ItemsService } from './items.js';

export class SettingsService extends ItemsService {
	constructor(options: AbstractServiceOptions) {
		super('directus_settings', options);
	}

	// The cache page edits `cache_ttl` through the settings singleton
	// (PATCH /settings). Broadcast the new value so every node's live override flips
	// at once, instead of waiting for a redeploy to re-seed it from the DB at boot.
	override async upsertSingleton(
		data: Partial<Item>,
		opts?: MutationOptions,
	): Promise<PrimaryKey> {
		// Gate before persisting: a non-empty value that ms can't parse to a positive
		// duration would be stored, then silently fall back on the hot path and desync
		// the __expires_at sidecar from the entry's real lifetime. Empty stays valid —
		// it clears the override back to env CACHE_TTL.
		if ('cache_ttl' in data) {
			const ttl = data['cache_ttl'];

			if (
				typeof ttl === 'string'
				&& ttl.trim() !== ''
				&& !isPositiveDuration(ttl)
			) {
				throw new InvalidPayloadError({
					reason: `Invalid cache_ttl "${ttl}" — expected a positive `
						+ `duration like "30s", "5m", "1h"`,
				});
			}
		}

		const result = await super.upsertSingleton(data, opts);

		if ('cache_ttl' in data) {
			const ttl = data['cache_ttl'] as string | null;
			publishCacheConfigChanged(ttl);

			// Best-effort marker for the cache-page timeseries; don't fail the save on it.
			void recordCacheConfigEvent('ttl_change', ttl).catch(() => {});
		}

		return result;
	}
}
