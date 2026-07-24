import type {
	AbstractServiceOptions,
	Item,
	MutationOptions,
	PrimaryKey,
} from '@directus/types';
import { publishCacheConfigChanged } from '../cache-config.js';
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
		const result = await super.upsertSingleton(data, opts);

		if ('cache_ttl' in data) {
			publishCacheConfigChanged(data['cache_ttl']);
		}

		return result;
	}
}
