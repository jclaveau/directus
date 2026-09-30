import { useEnv } from '@directus/env';
import { InvalidPayloadError } from '@directus/errors';
import type { Item } from '@directus/types';
import { parse as parseByteSize } from 'bytes';
import { useLogger } from './logger/index.js';
import type { SharedSettings } from './processes/lib/shared-settings.js';
import { isPositiveDuration } from './utils/get-milliseconds.js';

/**
 * `cache_settings`, mirrored so the hot path reads a module variable rather
 * than the database. A field it does not hold is answered by the environment
 * or the default its reader passes.
 */
let cacheSettings: SharedSettings = {};

function isByteSize(value: unknown): boolean {
	return typeof value === 'string' && (parseByteSize(value) ?? 0) > 0;
}

function isIntegerFrom(minimum: number) {
	return (value: unknown) => Number.isInteger(value) && (value as number) >= minimum;
}

/**
 * Every field the layer takes, and what a value has to be. Each one only
 * changes what a later fill or purge costs, never which entries a write
 * reaches: a field that could leave an entry no purge finds stays in the
 * environment.
 */
const CACHE_SETTING_RULES = {
	enabled: {
		accepts: (value: unknown) => typeof value === 'boolean',
		expected: 'true, false or null',
	},
	value_max_size: {
		accepts: (value: unknown) => value === false || isByteSize(value),
		expected: 'false, a size such as "2mb", or null',
	},
	stats_max_bytes: {
		accepts: isByteSize,
		expected: 'a size such as "2gb", or null',
	},
	audit_limit: {
		accepts: isIntegerFrom(0),
		expected: 'an integer from 0, or null',
	},
	audit_max_duration: {
		accepts: (value: unknown) => {
			return typeof value === 'string' && isPositiveDuration(value);
		},
		expected: 'a duration such as "10m", or null',
	},
	scoped_max_index_globs: {
		accepts: isIntegerFrom(1),
		expected: 'an integer from 1, or null',
	},
	scoped_index_scan_count: {
		accepts: isIntegerFrom(1),
		expected: 'an integer from 1, or null',
	},
	// Below 1 the index would expire before the entries it lists, and a purge
	// would miss them.
	scoped_index_ttl_factor: {
		accepts: (value: unknown) => {
			return typeof value === 'number' && Number.isFinite(value) && value >= 1;
		},
		expected: 'a number from 1, or null',
	},
} as const;

export type CacheSettingField = keyof typeof CACHE_SETTING_RULES;

function isCacheSettingField(field: string): field is CacheSettingField {
	return Object.hasOwn(CACHE_SETTING_RULES, field);
}

/**
 * Refuse a layer the mirror would read as something else: an unknown field is
 * a setting nothing applies, and a value its rule refuses reads as unset.
 */
export function assertUsableCacheSettings(document: SharedSettings): void {
	for (const [field, value] of Object.entries(document)) {
		if (isCacheSettingField(field) === false) {
			throw new InvalidPayloadError({
				reason: `'cache_settings.${field}' is not a cache setting`,
			});
		}

		const rule = CACHE_SETTING_RULES[field];

		if (value !== null && rule.accepts(value) === false) {
			throw new InvalidPayloadError({
				reason: `'cache_settings.${field}' has to be ${rule.expected}`,
			});
		}
	}
}

/**
 * The layer's value for `field`, else `fallback`. The mirror only holds values
 * their rule accepts, so the type is the one the rule checked.
 */
export function cacheSettingOr<T>(field: CacheSettingField, fallback: T): T {
	return (cacheSettings[field] ?? fallback) as T;
}

/** Whether this node serves and fills the response cache. */
export function cacheEnabled(): boolean {
	return cacheSettingOr('enabled', useEnv()['CACHE_ENABLED'] === true);
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
export async function refreshCacheSettings(): Promise<void> {
	const { SHARED_SETTINGS_COLUMNS, readSharedSettings } = await import(
		'./processes/lib/shared-settings.js'
	);

	const storedSettings = await readSharedSettings(SHARED_SETTINGS_COLUMNS.cache);
	const usableFields: SharedSettings = {};

	// A row written around the guard — by hand, or before a field had a rule —
	// keeps its usable fields rather than losing the whole layer.
	for (const [field, value] of Object.entries(storedSettings ?? {})) {
		if (isCacheSettingField(field) && CACHE_SETTING_RULES[field].accepts(value)) {
			usableFields[field] = value;
		}
	}

	cacheSettings = usableFields;
}

/**
 * Seed the mirror, leaving the environment in charge when the table cannot be
 * read — a boot ahead of its migrations has no column yet.
 */
export async function seedCacheSettings(): Promise<void> {
	try {
		await refreshCacheSettings();
	}
	catch (error: unknown) {
		useLogger().warn(
			error,
			'[cache] cache_settings is unreadable; the environment alone is read',
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

	if (asSharedSettings(payload[column])?.['enabled'] !== true || cacheEnabled()) {
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
export async function initCacheSettings(): Promise<void> {
	const logger = useLogger();

	const {
		SHARED_SETTINGS_COLUMNS,
		onSharedSettingsChanged,
		sharedSettingsPollMs,
	} = await import('./processes/lib/shared-settings.js');

	const rereadSetting = () => {
		refreshCacheSettings().catch((error: unknown) => {
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
