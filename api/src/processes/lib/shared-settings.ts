import { useEnv } from '@directus/env';
import type { AbstractServiceOptions } from '@directus/types';
import { parseJSON } from '@directus/utils';
import { useBus } from '../../bus/index.js';
import { useLogger } from '../../logger/index.js';

/**
 * The `directus_settings` columns holding a layer every process in the
 * deployment reads.
 *
 * Postgres owns them because they are tuning an operator changes during an
 * incident and is asked about weeks later: the table is migrated, backed up and
 * revisioned, and a write through the settings singleton leaves a row in
 * `directus_revisions` naming who made it.
 */
export const SHARED_SETTINGS_COLUMNS = {
	autoscale: 'autoscale_settings',
	supervisor: 'supervisor_settings',
} as const;

/** What the floor below falls back to, in seconds. */
const DEFAULT_POLL_SECONDS = 30;

/**
 * How long a mirror of one of these columns may go unrefreshed before it
 * re-reads unprompted.
 *
 * The announcement is what lands a change in a second; this is what lands it
 * at all on a node that missed one. A bus message is delivered at most once and
 * nothing replays it, so this floor is the difference between staleness that
 * heals and staleness that waits for a restart — and on a deployment with no
 * Redis there is no bus to miss a message on, so it is the only thing that
 * lands a change at all. Lower it there, at a select per node per interval.
 */
export function sharedSettingsPollMs(): number {
	const seconds = Number(useEnv()['SHARED_SETTINGS_POLL_SECONDS']);

	// Zero and below are refused rather than obeyed: the floor is read on the
	// scaling tick, so a floor of none is a select every time the pool is sized.
	return (Number.isFinite(seconds) && seconds > 0
		? seconds
		: DEFAULT_POLL_SECONDS) * 1000;
}

export type SharedSettingsColumn =
	(typeof SHARED_SETTINGS_COLUMNS)[keyof typeof SHARED_SETTINGS_COLUMNS];

export interface SharedSettings {
	[field: string]: unknown;
}

/**
 * The channel every node watches for a change to either column.
 *
 * It carries which column moved and nothing else. A subscriber answers by
 * re-reading the table, so a message lost to an outage costs staleness until
 * the next re-read rather than leaving a node running a value nothing stored.
 */
const CHANGED_CHANNEL = 'sharedSettingsChanged';

export interface SharedSettingsChange {
	column: SharedSettingsColumn;
}

/**
 * A JSON column comes back parsed on Postgres and as a string on sqlite, so
 * both arms are the dialect answering rather than a stored shape that varies.
 */
export function asSharedSettings(stored: unknown): SharedSettings | null {
	let value = stored;

	if (typeof value === 'string') {
		try {
			value = parseJSON(value);
		}
		catch {
			// A column edited by hand into something unparseable is answered as
			// nothing stored, which is what every reader makes of it too.
			return null;
		}
	}

	return typeof value === 'object'
		&& value !== null
		&& Array.isArray(value) === false
		? value as SharedSettings
		: null;
}

/** What the column holds, or `null` where it holds nothing usable. */
export async function readSharedSettings(
	column: SharedSettingsColumn,
): Promise<SharedSettings | null> {
	// Answered before the database is reached for, because `getDatabase` reports
	// a missing connection by ending the process rather than by throwing: a
	// caller asking for a tuning value cannot catch that, and the autoscaler
	// asking for one would be replaced by its supervisor and end the same way on
	// the next boot, leaving the pool at whatever size it was found at.
	if ('DB_CLIENT' in useEnv() === false) {
		return null;
	}

	// Imported lazily so the autoscaler — its own process, reading this on a slow
	// floor rather than on its tick — does not pull the dialect graph in at load.
	const { default: getDatabase } = await import('../../database/index.js');

	const row = await getDatabase()
		.select(column)
		.from('directus_settings')
		.first();

	return asSharedSettings(row?.[column]);
}

/**
 * Both columns in a single statement.
 *
 * A page reads them together — one is meaningless without the other, since a
 * value it shows could have come from either — so they are fetched together
 * rather than a row at a time.
 */
export async function readAllSharedSettings(): Promise<
	Record<SharedSettingsColumn, SharedSettings | null>
> {
	const columns = Object.values(SHARED_SETTINGS_COLUMNS);

	if ('DB_CLIENT' in useEnv() === false) {
		return { autoscale_settings: null, supervisor_settings: null };
	}

	const { default: getDatabase } = await import('../../database/index.js');

	const row = await getDatabase()
		.select(columns)
		.from('directus_settings')
		.first();

	return {
		autoscale_settings: asSharedSettings(row?.['autoscale_settings']),
		supervisor_settings: asSharedSettings(row?.['supervisor_settings']),
	};
}

/**
 * Store the layer, or clear it when nothing is left to store.
 *
 * Through the settings singleton rather than a knex update: that is what writes
 * the revision answering who moved a threshold and when, and what fires the
 * `settings.update` action the announcement below rides on.
 */
export async function writeSharedSettings(
	column: SharedSettingsColumn,
	settings: SharedSettings | null,
	options: AbstractServiceOptions,
): Promise<void> {
	const { SettingsService } = await import('../../services/settings.js');

	await new SettingsService(options).upsertSingleton({ [column]: settings });
}

/**
 * Answer a change to `column` by re-reading it.
 *
 * A bus that cannot be reached leaves this node on its own re-read floor rather
 * than ending it: subscribing is a command like any other, and a deployment
 * coming up while Redis is unreachable would otherwise lose the process that
 * holds its pool — the outage taking the pool with it, which is the failure
 * every layer here is arranged against.
 */
export function onSharedSettingsChanged(
	column: SharedSettingsColumn,
	reread: () => void,
): void {
	const subscribed = useBus()
		.subscribe<SharedSettingsChange>(CHANGED_CHANNEL, (change) => {
			if (change.column === column) {
				reread();
			}
		});

	subscribed.catch((error: unknown) => {
		useLogger().warn(
			error,
			'[shared-settings] no announcements will be heard; '
				+ 'the settings are re-read on their own floor',
		);
	});
}

/**
 * Announce every write this instance makes to either column, whatever made it.
 *
 * From the action rather than from `SettingsService`, for the reason
 * `initCacheConfig` gives: an import running against this instance writes the
 * singleton through a plain `ItemsService`, and the announcement has to ride
 * the write wherever inside the instance it came from.
 *
 * Registered with the app, so it covers the writes a process that built one
 * makes. A command that builds no app — a schema apply, a seed script — stores
 * the value with nobody to announce it, and the other nodes take it on their
 * own re-read floor instead.
 */
export async function initSharedSettings(): Promise<void> {
	const { default: emitter } = await import('../../emitter.js');

	emitter.onAction('settings.update', ({ payload }) => {
		if (!payload) {
			return;
		}

		for (const column of Object.values(SHARED_SETTINGS_COLUMNS)) {
			if (column in payload) {
				const announced = useBus()
					.publish<SharedSettingsChange>(CHANGED_CHANNEL, { column });

				// The write is already durable, so an unreachable bus costs the
				// other nodes their floor rather than the value. Dropped, it would
				// end the process that has just answered the operator.
				announced.catch((error: unknown) => {
					useLogger().warn(
						error,
						`[shared-settings] could not announce ${column}`,
					);
				});
			}
		}
	});
}
