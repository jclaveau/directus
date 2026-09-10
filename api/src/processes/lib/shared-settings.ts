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
function asSharedSettings(stored: unknown): SharedSettings | null {
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
 * Announce every write to either column, whatever wrote it.
 *
 * From the action rather than from `SettingsService`, for the reason
 * `initCacheConfig` gives: a config-sync import and a seed script both write the
 * singleton through a plain `ItemsService`, and a value stored without being
 * announced leaves each node on the layer it last read until it restarts.
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
