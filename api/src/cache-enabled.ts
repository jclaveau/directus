import { useEnv } from '@directus/env';
import { InvalidPayloadError } from '@directus/errors';
import type { Item } from '@directus/types';
import { useLogger } from './logger/index.js';
import type { SharedSettings } from './processes/lib/shared-settings.js';

/**
 * `cache_settings.enabled`, mirrored so the hot path reads a module variable
 * rather than the database. `null` means the layer does not set it, and env
 * `CACHE_ENABLED` answers.
 */
let enabledSetting: boolean | null = null;

function enabledIn(document: SharedSettings | null): boolean | null {
	return typeof document?.['enabled'] === 'boolean'
		? document['enabled']
		: null;
}

/**
 * Refuse a layer the mirror would read as something else: an unknown field is
 * a setting nothing applies, and a non-boolean `enabled` reads as unset.
 */
export function assertUsableCacheSettings(document: SharedSettings): void {
	for (const [field, value] of Object.entries(document)) {
		if (field !== 'enabled') {
			throw new InvalidPayloadError({
				reason: `'cache_settings.${field}' is not a cache setting`,
			});
		}

		if (typeof value !== 'boolean' && value !== null) {
			throw new InvalidPayloadError({
				reason: "'cache_settings.enabled' has to be true, false or null",
			});
		}
	}
}

/** Whether this node serves and fills the response cache. */
export function cacheEnabled(): boolean {
	return enabledSetting ?? useEnv()['CACHE_ENABLED'] === true;
}

/**
 * Whether this node holds a response cache at all.
 *
 * Wider than `cacheEnabled`: a write purges through the instance, so a node
 * where the setting switched serving off keeps it, and keeps purging. Were it
 * dropped, the entries filled before the switch would outlive every write made
 * while it was off, and be served again the moment it is switched back on.
 */
export function responseCacheWanted(): boolean {
	return useEnv()['CACHE_ENABLED'] === true || cacheEnabled();
}

/** Re-read the layer from `directus_settings` into the mirror. */
export async function refreshCacheEnabled(): Promise<void> {
	const { SHARED_SETTINGS_COLUMNS, readSharedSettings } = await import(
		'./processes/lib/shared-settings.js'
	);

	enabledSetting = enabledIn(
		await readSharedSettings(SHARED_SETTINGS_COLUMNS.cache),
	);
}

/**
 * Seed the mirror, leaving the environment in charge when the table cannot be
 * read — a boot ahead of its migrations has no column yet.
 */
export async function seedCacheEnabled(): Promise<void> {
	try {
		await refreshCacheEnabled();
	}
	catch (error: unknown) {
		useLogger().warn(
			error,
			'[cache] cache_settings is unreadable; CACHE_ENABLED alone is read',
		);
	}
}

/**
 * Drop the response cache before a write switches it on where the environment
 * leaves it off.
 *
 * Such a deployment has nodes that never held an instance, so the writes they
 * served purged nothing, and whatever an earlier period filled may be stale.
 * Before the write rather than after it: no node can start serving until the
 * row says so, and by then the entries are gone. A clear that is refused
 * refuses the write, rather than switching on over entries it could not drop.
 */
export async function flushBeforeEnabling(payload: Partial<Item>): Promise<void> {
	const { SHARED_SETTINGS_COLUMNS, asSharedSettings } = await import(
		'./processes/lib/shared-settings.js'
	);

	const column = SHARED_SETTINGS_COLUMNS.cache;

	if (column in payload === false || useEnv()['CACHE_ENABLED'] === true) {
		return;
	}

	if (enabledIn(asSharedSettings(payload[column])) !== true || cacheEnabled()) {
		return;
	}

	const { buildResponseCache, clearCacheTargets } = await import('./cache.js');

	buildResponseCache();
	await clearCacheTargets(['response']);
}

/**
 * Keep the mirror live: a change announced on the bus re-reads it at once, and
 * the shared-settings floor re-reads it on a node that missed the announcement.
 */
export async function initCacheEnabled(): Promise<void> {
	const logger = useLogger();

	const {
		SHARED_SETTINGS_COLUMNS,
		onSharedSettingsChanged,
		sharedSettingsPollMs,
	} = await import('./processes/lib/shared-settings.js');

	const rereadSetting = () => {
		refreshCacheEnabled().catch((error: unknown) => {
			logger.warn(error, '[cache] could not re-read cache_settings');
		});
	};

	onSharedSettingsChanged(SHARED_SETTINGS_COLUMNS.cache, rereadSetting);
	setInterval(rereadSetting, sharedSettingsPollMs()).unref();

	const { default: emitter } = await import('./emitter.js');

	// The create as well as the update: a deployment nobody has saved a setting
	// on yet has no singleton row, and the first write to it makes one.
	for (const event of ['settings.create', 'settings.update']) {
		emitter.onFilter<Partial<Item>>(event, async (payload) => {
			await flushBeforeEnabling(payload);

			return payload;
		});
	}
}
