import { useEnv } from '@directus/env';
import { InvalidPayloadError } from '@directus/errors';
import type { EventContext, Item } from '@directus/types';
import { parse as parseByteSize } from 'bytes';
import type { Knex } from 'knex';
import { useLogger } from './logger/index.js';
import type { SharedSettings } from './processes/lib/shared-settings.js';
import {
	getMilliseconds,
	isPositiveDuration,
} from './utils/get-milliseconds.js';

/**
 * `cache_settings`, mirrored so the hot path reads a module variable rather
 * than the database. A field it does not hold is answered by its rule's
 * fallback.
 */
let cacheSettings: SharedSettings = {};

/** Which read the mirror holds, so a slower earlier one cannot replace it. */
let startedSettingsReads = 0;
let appliedSettingsRead = 0;

const DAY_MS = 24 * 60 * 60 * 1000;

function isByteSize(value: unknown): boolean {
	return typeof value === 'string' && (parseByteSize(value) ?? 0) > 0;
}

function isIntegerBetween(minimum: number, maximum: number) {
	return (value: unknown) => {
		return Number.isInteger(value)
			&& (value as number) >= minimum
			&& (value as number) <= maximum;
	};
}

const isScanCount = isIntegerBetween(1, 100000);

// Below 1 the index would expire before the entries it lists, and a purge
// would miss them.
function isIndexTtlFactor(value: unknown): boolean {
	return typeof value === 'number' && value >= 1 && value <= 100;
}

/**
 * The variable's value where its rule accepts it, else `builtIn`: a value the
 * layer would refuse is refused from the environment too.
 */
function acceptedEnvOr(
	variable: string,
	accepts: (value: unknown) => boolean,
	builtIn: number,
): number {
	const envValue = useEnv()[variable];

	return accepts(envValue) ? envValue as number : builtIn;
}

/** What each field reads as, whether the layer or its fallback answers. */
export interface CacheSettingValues {
	response: boolean;
	value_max_size: string | false;
	stats_max_bytes: string | false | undefined;
	audit_limit: number | undefined;
	audit_max_duration: string | undefined;
	scoped_index_scan_count: number;
	scoped_index_ttl_factor: number;
}

export type CacheSettingField = keyof CacheSettingValues;

interface CacheSettingRule<F extends CacheSettingField> {
	accepts: (value: unknown) => boolean;
	expected: string;
	fallback: () => CacheSettingValues[F];
}

/** `CACHE_RESPONSE` where it is set, else `CACHE_ENABLED`. */
export function envResponseCache(): boolean {
	const env = useEnv();
	const responseSwitch = env['CACHE_RESPONSE'];

	if (typeof responseSwitch === 'boolean') {
		return responseSwitch;
	}

	return env['CACHE_ENABLED'] === true;
}

/**
 * Every field the layer takes, what a value has to be, and what answers when
 * the layer leaves it out. Each one only changes what a later fill or purge
 * costs, never which entries a write reaches: a field that could leave an
 * entry no purge finds stays in the environment.
 *
 * The upper bounds keep a value inside what Redis and the database accept: past
 * them the command a purge, a fill or a reap sends is refused.
 */
const CACHE_SETTING_RULES: {
	[F in CacheSettingField]: CacheSettingRule<F>;
} = {
	response: {
		accepts: (value) => typeof value === 'boolean',
		expected: 'true, false or null',
		fallback: envResponseCache,
	},
	value_max_size: {
		accepts: (value) => value === false || isByteSize(value),
		expected: 'false, a size such as "2mb", or null',
		fallback: () => useEnv()['CACHE_VALUE_MAX_SIZE'] as string | false,
	},
	stats_max_bytes: {
		accepts: (value) => value === false || isByteSize(value),
		expected: 'false, a size such as "2gb", or null',
		fallback: () => {
			return useEnv()['CACHE_STATS_MAX_BYTES'] as string | false | undefined;
		},
	},
	audit_limit: {
		accepts: isIntegerBetween(0, Number.MAX_SAFE_INTEGER),
		expected: 'an integer from 0, or null',
		fallback: () => useEnv()['CACHE_AUDIT_LIMIT'] as number | undefined,
	},
	audit_max_duration: {
		accepts: (value) => {
			return typeof value === 'string'
				&& isPositiveDuration(value)
				&& getMilliseconds(value, Infinity) <= DAY_MS;
		},
		expected: 'a duration such as "10m", up to "24h", or null',
		fallback: () => useEnv()['CACHE_AUDIT_MAX_DURATION'] as string | undefined,
	},
	scoped_index_scan_count: {
		accepts: isScanCount,
		expected: 'an integer from 1 to 100000, or null',
		fallback: () => {
			return acceptedEnvOr('CACHE_SCOPED_INDEX_SCAN_COUNT', isScanCount, 1000);
		},
	},
	scoped_index_ttl_factor: {
		accepts: isIndexTtlFactor,
		expected: 'a number from 1 to 100, or null',
		fallback: () => {
			return acceptedEnvOr('CACHE_SCOPED_INDEX_TTL_FACTOR', isIndexTtlFactor, 2);
		},
	},
};

function isCacheSettingField(field: string): field is CacheSettingField {
	return Object.hasOwn(CACHE_SETTING_RULES, field);
}

/**
 * Who wrote the layer, when, and through which surface. Stored beside the
 * fields, written by the write itself, and never a setting the mirror applies.
 */
const CACHE_SETTINGS_STAMP_FIELDS = ['setBy', 'setAt', 'setFrom'];

function isStampField(field: string): boolean {
	return CACHE_SETTINGS_STAMP_FIELDS.includes(field);
}

/**
 * Refuse a layer the mirror would read as something else: an unknown field is
 * a setting nothing applies, and a value its rule refuses reads as unset.
 */
export function assertUsableCacheSettings(document: SharedSettings): void {
	for (const [field, value] of Object.entries(document)) {
		if (isStampField(field)) {
			if (value !== null && typeof value !== 'string') {
				throw new InvalidPayloadError({
					reason: `'cache_settings.${field}' has to be a string`,
				});
			}

			continue;
		}

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
 * Refuse a patch the way a stored layer is refused, and a stamp field as well:
 * the stamp is the write's own, so a patch naming one names no cache setting.
 */
export function assertUsableCacheSettingsPatch(patch: SharedSettings): void {
	const stampField = Object.keys(patch).find(isStampField);

	if (stampField !== undefined) {
		throw new InvalidPayloadError({
			reason: `'cache_settings.${stampField}' is not a cache setting`,
		});
	}

	assertUsableCacheSettings(patch);
}

/**
 * The fields of a stored layer the mirror would apply. A row written around
 * the guard — by hand, or before a field had a rule — keeps its usable fields
 * rather than losing the whole layer.
 */
export function usableCacheSettings(
	document: SharedSettings | null,
): SharedSettings {
	const usableFields: SharedSettings = {};

	for (const [field, value] of Object.entries(document ?? {})) {
		if (isCacheSettingField(field) && CACHE_SETTING_RULES[field].accepts(value)) {
			usableFields[field] = value;
		}
	}

	return usableFields;
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
	source: 'settings' | 'env';
	/** What clearing the field would leave it on. */
	fallback: unknown;
}

/**
 * Every field as `document` resolves it here: the stored value its rule
 * accepts, else the fallback and where that comes from — the fallback given
 * either way.
 */
export function resolveCacheSettings(
	document: SharedSettings | null,
): Record<CacheSettingField, ResolvedCacheSetting> {
	const fields = Object.keys(CACHE_SETTING_RULES) as CacheSettingField[];

	return Object.fromEntries(fields.map((field) => {
		const rule = CACHE_SETTING_RULES[field];
		const stored = document?.[field];
		const fallback = rule.fallback() ?? null;

		const resolved: ResolvedCacheSetting = stored !== undefined
			&& stored !== null
			&& rule.accepts(stored)
			? { value: stored, source: 'settings', fallback }
			: { value: fallback, source: 'env', fallback };

		return [field, resolved];
	})) as Record<CacheSettingField, ResolvedCacheSetting>;
}

/** Whether this node serves and fills the response cache. */
export function cacheEnabled(): boolean {
	return cacheSetting('response');
}

/**
 * Whether this node holds a response cache at all.
 *
 * Wider than `cacheEnabled`: a write purges through the instance, so a node
 * holds one wherever an entry it could reach may be served. On Redis that is
 * every node, whatever `response` reads here: the store is shared, and a node
 * whose mirror lags the switch still has to purge what the others fill. On a
 * memory store only this node serves its entries, so it holds one once the
 * environment or the layer enables serving, and keeps it where the layer later
 * switches serving off.
 */
export function responseCacheWanted(): boolean {
	return envResponseCache()
		|| cacheEnabled()
		|| useEnv()['CACHE_STORE'] === 'redis';
}

/** Re-read the layer from `directus_settings` into the mirror. */
export async function refreshCacheSettings(): Promise<void> {
	const { SHARED_SETTINGS_COLUMNS, readSharedSettings } = await import(
		'./processes/lib/shared-settings.js'
	);

	startedSettingsReads += 1;
	const settingsRead = startedSettingsReads;
	const storedSettings = await readSharedSettings(SHARED_SETTINGS_COLUMNS.cache);

	// The poll and the bus each start a read, and the database may answer them
	// in either order.
	if (settingsRead < appliedSettingsRead) {
		return;
	}

	appliedSettingsRead = settingsRead;
	cacheSettings = usableCacheSettings(storedSettings);
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

/** The part of a filter's context the clear below is decided on. */
export interface EnablingWriteContext {
	accountability: EventContext['accountability'];
	database?: Knex;
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
 *
 * Decided on the stored row, which a node that missed an announcement may read
 * otherwise than its mirror does.
 */
export async function flushBeforeEnabling(
	payload: Partial<Item>,
	context: EnablingWriteContext,
): Promise<void> {
	const {
		SHARED_SETTINGS_COLUMNS,
		asSharedSettings,
		readSharedSettings,
	} = await import('./processes/lib/shared-settings.js');

	const column = SHARED_SETTINGS_COLUMNS.cache;

	if (column in payload === false || envResponseCache()) {
		return;
	}

	if (asSharedSettings(payload[column])?.['response'] !== true) {
		return;
	}

	// The access check and the guard both run after this filter, so a caller
	// or a write either would refuse must not clear the tier on its way there.
	if (context.accountability !== null && context.accountability?.admin !== true) {
		return;
	}

	const { assertUsableSharedSettings } = await import(
		'./processes/lib/settings-guard.js'
	);

	assertUsableSharedSettings(payload);

	const storedSettings = await readSharedSettings(column, context.database);

	if (storedSettings?.['response'] === true) {
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
		emitter.onFilter<Partial<Item>>(event, async (payload, _meta, context) => {
			await flushBeforeEnabling(payload, context);

			return payload;
		});
	}
}
