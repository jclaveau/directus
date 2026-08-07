import type {
	AbstractServiceOptions,
	Item,
	MutationOptions,
	PrimaryKey,
} from '@directus/types';
import { InvalidPayloadError } from '@directus/errors';
import { recordCacheConfigEvent } from '../cache-events.js';
import { isPositiveDuration } from '../utils/get-milliseconds.js';
import { ItemsService } from './items.js';

export class SettingsService extends ItemsService {
	constructor(options: AbstractServiceOptions) {
		super('directus_settings', options);
	}

	// The cache page edits `cache_ttl` through the settings singleton (PATCH
	// /settings). The broadcast that flips every node's live override rides the
	// `settings.update` action instead (see `initCacheConfig`), so it also covers
	// writers that never reach this service; what stays here is the validation the
	// write must not skip, and the timeseries marker.
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
			// Best-effort marker for the cache-page timeseries; don't fail the save on it.
			void recordCacheConfigEvent(
				'ttl_change',
				data['cache_ttl'] as string | null,
			).catch(() => {});
		}

		return result;
	}
}
