import { useEnv } from '@directus/env';
import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
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

// A number of bytes as well: the variable arrives as one when it is written as
// digits, and the response cache has always read it that way.
function isByteSize(value: unknown): boolean {
	if (Number.isInteger(value)) {
		return (value as number) > 0;
	}

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

// 0 is a cap too: no read is pinned by key, and each falls back to its
// collection's slices or bare pin.
const isPinCap = isIntegerBetween(0, 100000);

// 0 retries every recorded purge as its whole collection.
const isRetryFingerprintCap = isIntegerBetween(0, 100000);

// Below 1 the index would expire before the entries it lists, and a purge
// would miss them.
function isIndexTtlFactor(value: unknown): boolean {
	return typeof value === 'number' && value >= 1 && value <= 100;
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
	scoped_max_pins_per_collection: number;
	scoped_purge_retry_max_fingerprints: number;
}

export type CacheSettingField = keyof CacheSettingValues;

interface CacheSettingRule<F extends CacheSettingField> {
	variable: string;
	accepts: (value: unknown) => boolean;
	expected: string;
	fallback: () => CacheSettingValues[F];
}

/** `CACHE_RESPONSE` where it is set, else `CACHE_ENABLED`. */
export function envResponseCache(): boolean {
	const envVars = useEnv();
	const responseSwitch = envVars['CACHE_RESPONSE'];

	if (typeof responseSwitch === 'boolean') {
		return responseSwitch;
	}

	return envVars['CACHE_ENABLED'] === true;
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
		variable: 'CACHE_RESPONSE',
		accepts: (value) => typeof value === 'boolean',
		expected: 'true, false or null',
		fallback: envResponseCache,
	},
	value_max_size: {
		variable: 'CACHE_VALUE_MAX_SIZE',
		accepts: (value) => value === false || isByteSize(value),
		expected: 'false, a size such as "2mb", or null',
		fallback: () => useEnv()['CACHE_VALUE_MAX_SIZE'] as string | false,
	},
	stats_max_bytes: {
		variable: 'CACHE_STATS_MAX_BYTES',
		accepts: (value) => value === false || isByteSize(value),
		expected: 'false, a size such as "2gb", or null',
		// The variable is typed a string, so its `false` arrives spelled out.
		fallback: () => {
			const envValue = useEnv()['CACHE_STATS_MAX_BYTES'];

			if (envValue === 'false') {
				return false;
			}

			return envValue as string | false | undefined;
		},
	},
	audit_limit: {
		variable: 'CACHE_AUDIT_LIMIT',
		accepts: isIntegerBetween(0, Number.MAX_SAFE_INTEGER),
		expected: 'an integer from 0, or null',
		fallback: () => useEnv()['CACHE_AUDIT_LIMIT'] as number | undefined,
	},
	audit_max_duration: {
		variable: 'CACHE_AUDIT_MAX_DURATION',
		accepts: (value) => {
			return typeof value === 'string'
				&& isPositiveDuration(value)
				&& getMilliseconds(value, Infinity) <= DAY_MS;
		},
		expected: 'a duration such as "10m", up to "24h", or null',
		fallback: () => useEnv()['CACHE_AUDIT_MAX_DURATION'] as string | undefined,
	},
	scoped_index_scan_count: {
		variable: 'CACHE_SCOPED_INDEX_SCAN_COUNT',
		accepts: isScanCount,
		expected: 'an integer from 1 to 100000, or null',
		fallback: () => {
			return (useEnv()['CACHE_SCOPED_INDEX_SCAN_COUNT'] ?? 1000) as number;
		},
	},
	scoped_index_ttl_factor: {
		variable: 'CACHE_SCOPED_INDEX_TTL_FACTOR',
		accepts: isIndexTtlFactor,
		expected: 'a number from 1 to 100, or null',
		fallback: () => {
			return (useEnv()['CACHE_SCOPED_INDEX_TTL_FACTOR'] ?? 2) as number;
		},
	},
	// A read past the cap falls back to a wider pin, and a purge finds an entry
	// by the written row's values whatever cap filed it: a change only moves
	// what later fills cost and how much a later write evicts.
	scoped_max_pins_per_collection: {
		variable: 'CACHE_SCOPED_MAX_PINS_PER_COLLECTION',
		accepts: isPinCap,
		expected: 'an integer from 0 to 100000, or null',
		fallback: () => {
			return (useEnv()['CACHE_SCOPED_MAX_PINS_PER_COLLECTION'] ?? 250) as number;
		},
	},
	// Past the cap a retry purges the collection whole rather than one slice at a
	// time: wider, never staler, so a change only moves what a retry costs and how
	// much of the cache it drops.
	scoped_purge_retry_max_fingerprints: {
		variable: 'CACHE_SCOPED_PURGE_RETRY_MAX_FINGERPRINTS',
		accepts: isRetryFingerprintCap,
		expected: 'an integer from 0 to 100000, or null',
		fallback: () => {
			return (useEnv()['CACHE_SCOPED_PURGE_RETRY_MAX_FINGERPRINTS'] ?? 100) as
				number;
		},
	},
};

/**
 * Refuse a variable the layer's own rule would refuse, at boot, before the
 * server listens: a deployment carrying one fails its healthcheck and the one
 * before keeps the traffic, rather than running on a value nobody asked for.
 * An optional variable left unset is not checked.
 */
export function validateCacheSettingsEnv(): void {
	for (const cacheRule of Object.values(CACHE_SETTING_RULES)) {
		const envValue = cacheRule.fallback();

		if (envValue === undefined || cacheRule.accepts(envValue)) {
			continue;
		}

		useLogger().error(
			`"${cacheRule.variable}" Environment Variable is ${JSON.stringify(envValue)}, `
				+ `which is not ${cacheRule.expected.replace(/, or null$/, '')}.`,
		);

		process.exit(1);
	}
}

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

		const cacheRule = CACHE_SETTING_RULES[field];

		if (value !== null && cacheRule.accepts(value) === false) {
			throw new InvalidPayloadError({
				reason: `'cache_settings.${field}' has to be ${cacheRule.expected}`,
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
	const settingFields = Object.keys(
		CACHE_SETTING_RULES,
	) as CacheSettingField[];

	return Object.fromEntries(settingFields.map((field) => {
		const cacheRule = CACHE_SETTING_RULES[field];
		const storedValue = document?.[field];
		const envFallback = cacheRule.fallback() ?? null;

		const resolvedSetting: ResolvedCacheSetting = storedValue !== undefined
			&& storedValue !== null
			&& cacheRule.accepts(storedValue)
			? { value: storedValue, source: 'settings', fallback: envFallback }
			: { value: envFallback, source: 'env', fallback: envFallback };

		return [field, resolvedSetting];
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
	catch (readError: unknown) {
		useLogger().warn(
			readError,
			'[cache] cache_settings is unreadable; the environment alone is read',
		);
	}
}

/**
 * The transactions whose write already had its clear, taken before the
 * transaction opened so the row lock is not held across it.
 */
const enablingFlushedAhead = new WeakSet<Knex>();

/** Let the filter below skip the clear for a write that already had it. */
export function markEnablingFlushed(transaction: Knex): void {
	enablingFlushedAhead.add(transaction);
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
 * otherwise than its mirror does. Answers whether it cleared.
 */
export async function flushBeforeEnabling(
	payload: Partial<Item>,
	context: EnablingWriteContext,
): Promise<boolean> {
	const {
		SHARED_SETTINGS_COLUMNS,
		asSharedSettings,
		readSharedSettings,
	} = await import('./processes/lib/shared-settings.js');

	const settingsColumn = SHARED_SETTINGS_COLUMNS.cache;

	if (settingsColumn in payload === false || envResponseCache()) {
		return false;
	}

	if (asSharedSettings(payload[settingsColumn])?.['response'] !== true) {
		return false;
	}

	if (context.database && enablingFlushedAhead.has(context.database)) {
		return false;
	}

	// The access check runs after this filter, so a caller it would refuse must
	// not clear the tier on its way there; nor may one it would let through
	// switch on without the clear.
	if (context.accountability !== null && context.accountability?.admin !== true) {
		throw new ForbiddenError();
	}

	// The guard runs after this filter too, so a write it would refuse must not
	// clear the tier either.

	const { assertUsableSharedSettings } = await import(
		'./processes/lib/settings-guard.js'
	);

	assertUsableSharedSettings(payload);

	const storedSettings = await readSharedSettings(settingsColumn, context.database);

	if (storedSettings?.['response'] === true) {
		return false;
	}

	const { buildResponseCache, clearCacheTargets } = await import('./cache.js');

	buildResponseCache();
	await clearCacheTargets(['response']);

	return true;
}

/**
 * Keep the mirror live: a change announced on the bus re-reads it at once, and
 * the shared-settings floor re-reads it on a node that missed the announcement.
 */
export async function initCacheSettings(): Promise<void> {
	const cacheLogger = useLogger();

	const {
		SHARED_SETTINGS_COLUMNS,
		onSharedSettingsChanged,
		sharedSettingsPollMs,
	} = await import('./processes/lib/shared-settings.js');

	const rereadSetting = () => {
		refreshCacheSettings().catch((refreshError: unknown) => {
			cacheLogger.warn(
				refreshError,
				'[cache] could not re-read cache_settings',
			);
		});
	};

	onSharedSettingsChanged(SHARED_SETTINGS_COLUMNS.cache, rereadSetting);
	setInterval(rereadSetting, sharedSettingsPollMs()).unref();

	const { default: emitter } = await import('./emitter.js');

	// The create as well as the update: a deployment nobody has saved a setting
	// on yet has no singleton row, and the first write to it makes one.
	for (const event of ['settings.create.one', 'settings.update.one']) {
		emitter.onFilter<Partial<Item>>(event, async (payload, _meta, context) => {
			await flushBeforeEnabling(payload, context);

			return payload;
		});
	}
}
