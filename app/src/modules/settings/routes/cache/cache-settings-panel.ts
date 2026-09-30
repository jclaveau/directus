/** What a field holds, which is what the row renders and how a write is typed. */
export type CacheSettingKind = 'boolean' | 'number' | 'size' | 'text';

/** Where a field's value comes from, as the api resolves it. */
export type CacheSettingSource = 'settings' | 'env' | 'default';

export interface CacheSettingOption {
	text: string;
	value: string;
}

export interface CacheSettingField {
	field: string;
	/**
	 * The variable the field overrides, which is what the page names it by, or
	 * none where a built-in default is what it overrides.
	 */
	variable: string | null;
	kind: CacheSettingKind;
	/** What this field does to the cache, in a sentence, shown on hover. */
	description: string;
	/** What the number counts, shown at the end of the input. */
	unit?: string;
	min?: number;
	step?: number;
	/** Every value the field accepts, where it accepts a fixed few. */
	options?: CacheSettingOption[];
}

/** One field as the answering node resolves it. */
export interface ResolvedCacheSetting {
	value: unknown;
	source: CacheSettingSource;
	/** What clearing the field would leave it on. */
	fallback: unknown;
}

export interface CacheSettingsAnswer {
	key: string;
	sharedSettings: Record<string, unknown> | null;
	/** The address behind the stored `setBy`, `null` where there is none. */
	setByEmail?: string | null;
	resolved: Record<string, ResolvedCacheSetting>;
}

/** Who wrote the stored settings, through which surface, and how long ago. */
export interface CacheSettingsStamp {
	setBy: string | null;
	setFrom: 'admin' | 'mcp' | null;
	days: number;
}

/**
 * The stamp of the last write, `null` where nothing stamped one. The address
 * where the api could name one, else the id it stamped: a user since deleted
 * is still worth reporting as an id.
 */
export function cacheSettingsStamp(
	answer: CacheSettingsAnswer | null,
	nowMs: number,
): CacheSettingsStamp | null {
	const setAt = answer?.sharedSettings?.['setAt'];

	if (typeof setAt !== 'string') {
		return null;
	}

	const setBy = answer?.sharedSettings?.['setBy'];
	const setFrom = answer?.sharedSettings?.['setFrom'];

	return {
		setBy: answer?.setByEmail ?? (typeof setBy === 'string'
			? setBy
			: null),
		setFrom: setFrom === 'admin' || setFrom === 'mcp'
			? setFrom
			: null,
		days: Math.floor((nowMs - Date.parse(setAt)) / 86_400_000),
	};
}

/**
 * The fields, in the order they are read: the switch, what a fill may cost,
 * the telemetry budget, the audit, then the scoped purge.
 *
 * The bounds here shape the input; the settings guard is what enforces them,
 * and its refusal is shown as it came.
 */
export const CACHE_SETTING_FIELDS: CacheSettingField[] = [
	{
		field: 'response',
		variable: 'CACHE_RESPONSE',
		kind: 'boolean',
		description: 'Disabled stops every node serving and filling the response '
			+ 'cache. Enabling it where CACHE_RESPONSE, else CACHE_ENABLED, is off '
			+ 'clears the response cache first, so nothing filled before is served.',
		options: [
			{ text: 'enabled', value: 'true' },
			{ text: 'disabled', value: 'false' },
		],
	},
	{
		field: 'value_max_size',
		variable: 'CACHE_VALUE_MAX_SIZE',
		kind: 'size',
		description: 'The largest response filled into the cache, such as '
			+ '"2mb", or false for no cap.',
	},
	{
		field: 'stats_max_bytes',
		variable: 'CACHE_STATS_MAX_BYTES',
		kind: 'size',
		description: 'How much the cache telemetry tables may hold, such as '
			+ '"2gb", before their oldest chunks are dropped.',
	},
	{
		field: 'audit_limit',
		variable: 'CACHE_AUDIT_LIMIT',
		kind: 'number',
		description: 'How many queued entries an audit asked for no limit takes, '
			+ '0 for the whole queue.',
		unit: 'entries',
		min: 0,
		step: 1,
	},
	{
		field: 'audit_max_duration',
		variable: 'CACHE_AUDIT_MAX_DURATION',
		kind: 'text',
		description: 'How long an audit may run, such as "10m", before it leaves '
			+ 'the rest to the next one.',
	},
	{
		field: 'scoped_max_index_globs',
		variable: null,
		kind: 'number',
		description: 'How many patterns a scoped purge narrows a tag index with. '
			+ 'Past it the index is read whole and every member tested.',
		unit: 'globs',
		min: 1,
		step: 1,
	},
	{
		field: 'scoped_index_scan_count',
		variable: null,
		kind: 'number',
		description: 'How many members each SSCAN of a tag index looks at per '
			+ 'round trip.',
		unit: 'keys',
		min: 1,
		step: 1,
	},
	{
		field: 'scoped_index_ttl_factor',
		variable: null,
		kind: 'number',
		description: 'How much longer a tag index lives than the entries it '
			+ 'lists. Below 1 a purge would miss entries, so the guard refuses it.',
		unit: '× TTL',
		min: 1,
		step: 0.5,
	},
];

export interface CacheSettingRow extends CacheSettingField {
	/** What the node runs on, `null` where the field has no value. */
	value: unknown;
	/** Where that value came from, `null` where nothing was read yet. */
	source: CacheSettingSource | null;
	/** What the shared settings set, `null` where they set nothing for this field. */
	sharedSettings: unknown;
	/** What clearing the field would leave it on. */
	fallback: unknown;
}

/** One row per field: what it runs on, where that came from, what is stored. */
export function cacheSettingRows(
	answer: CacheSettingsAnswer | null,
): CacheSettingRow[] {
	return CACHE_SETTING_FIELDS.map((definition) => {
		const resolved = answer?.resolved[definition.field];

		return {
			...definition,
			value: resolved?.value ?? null,
			source: resolved?.source ?? null,
			sharedSettings: answer?.sharedSettings?.[definition.field] ?? null,
			fallback: resolved?.fallback ?? null,
		};
	});
}

/** What a value typed into a row means, `null` clearing the field. */
export function parseCacheSettingValue(
	kind: CacheSettingKind,
	raw: unknown,
): unknown {
	if (raw === null || raw === undefined || raw === '') {
		return null;
	}

	if (kind === 'number') {
		const parsed = Number(raw);

		return Number.isFinite(parsed)
			? parsed
			: null;
	}

	if (kind === 'boolean') {
		return raw === true || raw === 'true';
	}

	// A size has one value that is not a size: no cap at all.
	if (kind === 'size' && (raw === false || raw === 'false')) {
		return false;
	}

	return String(raw);
}
