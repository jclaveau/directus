import { useEnv } from '@directus/env';
import { InvalidPayloadError } from '@directus/errors';
import { useRedis } from '../../redis/index.js';
import { supervisorOverrideKey } from './resolve-config.js';

/**
 * The pm2 options a rolling restart can carry.
 *
 * pm2 clones a worker's `pm2_env` to make its replacement, and a reload may
 * extend that object first, so a value pushed with the roll is the one the
 * replacement boots under. Pool size and execution mode are not here: neither
 * survives that route, and the size is the loop's to decide anyway.
 */
export interface SupervisorOverride {
	[field: string]: unknown;
}

/** The bounds a value has to sit in, and the pm2 entry it is written to. */
interface SupervisorField {
	entry: string;
	min: number;
	max: number;
}

const FIELDS: Record<string, SupervisorField> = {
	listenTimeout: { entry: 'listen_timeout', min: 1000, max: 600_000 },
	killTimeout: { entry: 'kill_timeout', min: 100, max: 600_000 },
	minUptime: { entry: 'min_uptime', min: 100, max: 600_000 },
	restartDelay: { entry: 'restart_delay', min: 0, max: 600_000 },
	maxRestarts: { entry: 'max_restarts', min: 0, max: 1000 },
	maxMemoryRestartMegabytes: { entry: 'max_memory_restart', min: 64, max: 65_536 },
};

/**
 * What the override carries besides the values themselves, kept out of what is
 * handed to pm2 — the same stamp the configuration override takes, and for the
 * same reason: an override outlives the incident that justified it.
 */
const NOTE_FIELDS = ['setBy', 'setAt', 'setFrom', 'note'];

const MEGABYTE = 1_048_576;

/** What pm2 falls back to, matching `ecosystem.config.cjs` entry for entry. */
const ENV_FALLBACKS: Record<string, number | null> = {
	listenTimeout: 15000,
	killTimeout: 1600,
	minUptime: 1000,
	restartDelay: 0,
	maxRestarts: 16,
	maxMemoryRestartMegabytes: null,
};

const ENV_VARIABLES: Record<string, string> = {
	listenTimeout: 'PM2_LISTEN_TIMEOUT',
	killTimeout: 'PM2_KILL_TIMEOUT',
	minUptime: 'PM2_MIN_UPTIME',
	restartDelay: 'PM2_RESTART_DELAY',
	maxRestarts: 'PM2_MAX_RESTARTS',
	maxMemoryRestartMegabytes: 'PM2_MAX_MEMORY_RESTART',
};

export async function readSupervisorOverride(): Promise<SupervisorOverride | null> {
	const stored = await useRedis().get(supervisorOverrideKey());

	if (!stored) {
		return null;
	}

	try {
		const parsed: unknown = JSON.parse(stored);

		return typeof parsed === 'object' && parsed !== null
			? parsed as SupervisorOverride
			: null;
	}
	catch {
		// A key edited by hand into something unparseable is reported as no
		// override, which is what a restart makes of it too.
		return null;
	}
}

export async function writeSupervisorOverride(
	override: SupervisorOverride | null,
): Promise<void> {
	const redis = useRedis();

	if (override === null) {
		await redis.del(supervisorOverrideKey());
		return;
	}

	await redis.set(supervisorOverrideKey(), JSON.stringify(override));
}

/**
 * The patch, checked field by field.
 *
 * Bounds are refused here rather than clamped: nothing downstream corrects
 * these, so a value out of range would be handed to the supervisor as typed —
 * a `kill_timeout` of zero drops every request a released worker was serving.
 */
export function parseSupervisorPatch(
	patch: Record<string, unknown>,
): Record<string, unknown> {
	const parsed: Record<string, unknown> = {};

	for (const [field, value] of Object.entries(patch)) {
		if (NOTE_FIELDS.includes(field)) {
			if (value !== null && typeof value !== 'string') {
				throw new InvalidPayloadError({
					reason: `'${field}' has to be a string`,
				});
			}

			parsed[field] = value;
			continue;
		}

		const bounds = FIELDS[field];

		if (bounds === undefined) {
			throw new InvalidPayloadError({
				reason: `'${field}' is not an option a restart can carry`,
			});
		}

		// Null hands one field back to the environment, which is how a single
		// value is released without dropping the whole override.
		if (value === null) {
			parsed[field] = null;
			continue;
		}

		const usable = typeof value === 'number'
			&& Number.isInteger(value)
			&& value >= bounds.min
			&& value <= bounds.max;

		if (usable === false) {
			throw new InvalidPayloadError({
				reason: `'${field}' has to be a whole number `
					+ `between ${bounds.min} and ${bounds.max}`,
			});
		}

		parsed[field] = value;
	}

	return parsed;
}

/**
 * The override with the patch applied, a `null` value removing its field.
 *
 * An override holding nothing but its own stamp is removed altogether, so a
 * page reading it back does not show a supervisor as overridden when every
 * value it runs on came from the environment.
 */
export function applySupervisorPatch(
	override: SupervisorOverride | null,
	patch: Record<string, unknown>,
): SupervisorOverride | null {
	const merged: SupervisorOverride = { ...override };

	for (const [field, value] of Object.entries(patch)) {
		if (value === null) {
			delete merged[field];
		}
		else {
			merged[field] = value;
		}
	}

	const configured = Object.keys(merged)
		.filter((field) => NOTE_FIELDS.includes(field) === false);

	return configured.length === 0
		? null
		: merged;
}

/** Megabytes in each suffix pm2 takes a size in. */
const SIZE_UNITS: Record<string, number> = { K: 1 / 1024, M: 1, G: 1024 };

/**
 * A memory ceiling in megabytes, however pm2 was asked for it.
 *
 * pm2 takes this one as a size rather than as a number — `512M` as readily as
 * the bytes a bare number means — while the panel asks for megabytes, so the
 * two have to meet somewhere.
 */
function megabytesOf(declared: unknown): number | null {
	const size = /^(\d+(?:\.\d+)?)\s*([KMG])?B?$/i.exec(String(declared).trim());

	if (size === null) {
		return null;
	}

	const unit = size[2]?.toUpperCase();

	return unit === undefined
		? Math.round(Number(size[1]) / MEGABYTE)
		: Math.round(Number(size[1]) * (SIZE_UNITS[unit] as number));
}

/**
 * What the environment asks for, which is what a released field goes back to.
 *
 * Read here rather than off the running pool: a restart that pushed a value
 * has already replaced what the supervisor reports, so the pool can no longer
 * say what it was started with.
 */
function fromEnv(field: string): number | null {
	const declared = useEnv()[ENV_VARIABLES[field] as string];

	if (declared === undefined) {
		return ENV_FALLBACKS[field] ?? null;
	}

	const parsed = field === 'maxMemoryRestartMegabytes'
		? megabytesOf(declared)
		: Number(declared);

	return parsed === null || Number.isFinite(parsed) === false
		? ENV_FALLBACKS[field] ?? null
		: parsed;
}

/**
 * Every option a restart carries, as pm2 names them.
 *
 * The full set every time, not only what the override holds: pm2 keeps the
 * extended declaration on the running process, so a field released from the
 * override goes back to the environment's value only if the restart says so.
 */
export function reloadDeclaration(
	override: SupervisorOverride | null,
): Record<string, number> {
	const declaration: Record<string, number> = {};

	for (const [field, { entry }] of Object.entries(FIELDS)) {
		const overridden = override?.[field];

		const value = typeof overridden === 'number'
			? overridden
			: fromEnv(field);

		if (value === null) {
			continue;
		}

		declaration[entry] = field === 'maxMemoryRestartMegabytes'
			? value * MEGABYTE
			: value;
	}

	return declaration;
}
