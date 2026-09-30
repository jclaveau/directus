import { useEnv } from '@directus/env';
import { InvalidPayloadError } from '@directus/errors';
import type { Item } from '@directus/types';
import { parse as parseByteSize } from 'bytes';
import { useLogger } from './logger/index.js';
import type { SharedSettings } from './processes/lib/shared-settings.js';
import { isPositiveDuration } from './utils/get-milliseconds.js';

/**
 * `cache_settings`, mirrored so the hot path reads a module variable rather
 * than the database. A field it does not hold is answered by its rule's
 * fallback.
 */
let cacheSettings: SharedSettings = {};

function isByteSize(value: unknown): boolean {
	return typeof value === 'string' && (parseByteSize(value) ?? 0) > 0;
}

function isIntegerFrom(minimum: number) {
	return (value: unknown) => Number.isInteger(value) && (value as number) >= minimum;
}

/** What each field reads as, whether the layer or its fallback answers. */
export interface CacheSettingValues {
	enabled: boolean;
	value_max_size: string | false;
	stats_max_bytes: string | false | undefined;
	audit_limit: number | undefined;
	audit_max_duration: string | undefined;
	scoped_max_index_globs: number;
	scoped_index_scan_count: number;
	scoped_index_ttl_factor: number;
}

export type CacheSettingField = keyof CacheSettingValues;

/** Where a field's value comes from when the layer does not set it. */
export type CacheSettingFallbackSource = 'env' | 'default';

interface CacheSettingRule<F extends CacheSettingField> {
	accepts: (value: unknown) => boolean;
	expected: string;
	fallbackSource: CacheSettingFallbackSource;
	fallback: () => CacheSettingValues[F];
}

/**
 * Every field the layer takes, what a value has to be, and what answers when
 * the layer leaves it out. Each one only changes what a later fill or purge
 * costs, never which entries a write reaches: a field that could leave an
 * entry no purge finds stays in the environment.
 */
const CACHE_SETTING_RULES: {
	[F in CacheSettingField]: CacheSettingRule<F>;
} = {
	enabled: {
		accepts: (value) => typeof value === 'boolean',
		expected: 'true, false or null',
		fallbackSource: 'env',
		fallback: () => useEnv()['CACHE_ENABLED'] === true,
	},
	value_max_size: {
		accepts: (value) => value === false || isByteSize(value),
		expected: 'false, a size such as "2mb", or null',
		fallbackSource: 'env',
		fallback: () => useEnv()['CACHE_VALUE_MAX_SIZE'] as string | false,
	},
	stats_max_bytes: {
		accepts: isByteSize,
		expected: 'a size such as "2gb", or null',
		fallbackSource: 'env',
		fallback: () => {
			return useEnv()['CACHE_STATS_MAX_BYTES'] as string | false | undefined;
		},
	},
	audit_limit: {
		accepts: isIntegerFrom(0),
		expected: 'an integer from 0, or null',
		fallbackSource: 'env',
		fallback: () => useEnv()['CACHE_AUDIT_LIMIT'] as number | undefined,
	},
	audit_max_duration: {
		accepts: (value) => typeof value === 'string' && isPositiveDuration(value),
		expected: 'a duration such as "10m", or null',
		fallbackSource: 'env',
		fallback: () => useEnv()['CACHE_AUDIT_MAX_DURATION'] as string | undefined,
	},
	scoped_max_index_globs: {
		accepts: isIntegerFrom(1),
		expected: 'an integer from 1, or null',
		fallbackSource: 'default',
		fallback: () => 64,
	},
	scoped_index_scan_count: {
		accepts: isIntegerFrom(1),
		expected: 'an integer from 1, or null',
		fallbackSource: 'default',
		fallback: () => 1000,
	},
	// Below 1 the index would expire before the entries it lists, and a purge
	// would miss them.
	scoped_index_ttl_factor: {
		accepts: (value) => {
			return typeof value === 'number' && Number.isFinite(value) && value >= 1;
		},
		expected: 'a number from 1, or null',
		fallbackSource: 'default',
		fallback: () => 2,
	},
};

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
 * The layer's value for `field`, else its rule's fallback. The mirror only
 * holds values their rule accepts, so the type is the one the rule checked.
 */
export function cacheSetting<F extends CacheSettingField>(
	field: F,
): CacheSettingValues[F] {
	return (cacheSettings[field] ?? CACHE_SETTING_RULES[field].fallback()) as
		CacheSettingValues[F];
}

/** One field as a stored layer resolves it on this node. */
export interface ResolvedCacheSetting {
	value: unknown;
	source: 'settings' | CacheSettingFallbackSource;
}

/**
 * Every field as `document` resolves it here: the stored value its rule
 * accepts, else the fallback and where that comes from.
 */
export function resolveCacheSettings(
	document: SharedSettings | null,
): Record<CacheSettingField, ResolvedCacheSetting> {
	const fields = Object.keys(CACHE_SETTING_RULES) as CacheSettingField[];

	return Object.fromEntries(fields.map((field) => {
		const rule = CACHE_SETTING_RULES[field];
		const stored = document?.[field];

		const resolved: ResolvedCacheSetting = stored !== undefined
			&& stored !== null
			&& rule.accepts(stored)
			? { value: stored, source: 'settings' }
			: { value: rule.fallback() ?? null, source: rule.fallbackSource };

		return [field, resolved];
	})) as Record<CacheSettingField, ResolvedCacheSetting>;
}

/** Whether this node serves and fills the response cache. */
export function cacheEnabled(): boolean {
	return cacheSetting('enabled');
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
