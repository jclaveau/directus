import { useLogger } from "../../logger/index.js";
import { useBus } from "../../bus/lib/use-bus.js";
import "../../bus/index.js";
import { useEnv } from "@directus/env";
import { parseJSON } from "@directus/utils";

//#region src/processes/lib/shared-settings.ts
/**
* The `directus_settings` columns holding a layer every process in the
* deployment reads.
*
* Postgres owns them because they are tuning an operator changes during an
* incident and is asked about weeks later: the table is migrated, backed up and
* revisioned, and a write through the settings singleton leaves a row in
* `directus_revisions` naming who made it.
*/
const SHARED_SETTINGS_COLUMNS = {
	autoscale: "autoscale_settings",
	supervisor: "supervisor_settings"
};
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
function sharedSettingsPollMs() {
	const seconds = Number(useEnv()["SHARED_SETTINGS_POLL_SECONDS"]);
	return (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_POLL_SECONDS) * 1e3;
}
/**
* The channel every node watches for a change to either column.
*
* It carries which column moved and nothing else. A subscriber answers by
* re-reading the table, so a message lost to an outage costs staleness until
* the next re-read rather than leaving a node running a value nothing stored.
*/
const CHANGED_CHANNEL = "sharedSettingsChanged";
/**
* A JSON column comes back parsed on Postgres and as a string on sqlite, so
* both arms are the dialect answering rather than a stored shape that varies.
*/
function asSharedSettings(stored) {
	let value = stored;
	if (typeof value === "string") try {
		value = parseJSON(value);
	} catch {
		return null;
	}
	return typeof value === "object" && value !== null && Array.isArray(value) === false ? value : null;
}
let lastUndeclared = "";
/**
* Whether the connection a read would go through is declared in full.
*
* Answered before the database is reached for, because `getDatabase` reports an
* incomplete connection by ending the process rather than by throwing: a caller
* asking for a tuning value cannot catch that, and the autoscaler asking for one
* would be replaced by its supervisor and end the same way on the next boot,
* leaving the pool at whatever size it was found at.
*
* The whole connection rather than `DB_CLIENT` alone. That variable is where the
* requirement starts, not what it comes to: which fields are needed depends on
* the dialect and on whether a connection string was given, and a deployment
* missing one of the others ends the same process just as surely.
*
* Read off the module that owns the requirement rather than a list kept beside
* it, so a dialect whose fields change is answered here by the same table the
* check itself uses.
*/
async function connectionIsDeclared() {
	const env = useEnv();
	if ("DB_CLIENT" in env === false) return false;
	const { connectionFieldEnvKey, getBaseDbConfig, requiredConnectionFields } = await import("../../database/connections.js");
	const missing = requiredConnectionFields(getBaseDbConfig()).map((field) => connectionFieldEnvKey("DB_", field)).filter((key) => key in env === false);
	if (missing.length === 0) {
		lastUndeclared = "";
		return true;
	}
	if (missing.join(", ") !== lastUndeclared) {
		lastUndeclared = missing.join(", ");
		useLogger().warn(`[shared-settings] the connection is missing ${lastUndeclared}; the environment chain alone is read`);
	}
	return false;
}
/** What the column holds, or `null` where it holds nothing usable. */
async function readSharedSettings(column) {
	if (await connectionIsDeclared() === false) return null;
	const { default: getDatabase } = await import("../../database/index.js");
	return asSharedSettings((await getDatabase().select(column).from("directus_settings").first())?.[column]);
}
/**
* Both columns in a single statement.
*
* A page reads them together — one is meaningless without the other, since a
* value it shows could have come from either — so they are fetched together
* rather than a row at a time.
*/
async function readAllSharedSettings() {
	const columns = Object.values(SHARED_SETTINGS_COLUMNS);
	if (await connectionIsDeclared() === false) return {
		autoscale_settings: null,
		supervisor_settings: null
	};
	const { default: getDatabase } = await import("../../database/index.js");
	const row = await getDatabase().select(columns).from("directus_settings").first();
	return {
		autoscale_settings: asSharedSettings(row?.["autoscale_settings"]),
		supervisor_settings: asSharedSettings(row?.["supervisor_settings"])
	};
}
/**
* Store the layer, or clear it when nothing is left to store.
*
* Through the settings singleton rather than a knex update: that is what writes
* the revision answering who moved a threshold and when, and what fires the
* `settings.update` action the announcement below rides on.
*/
async function writeSharedSettings(column, settings, options) {
	const { SettingsService } = await import("../../services/settings.js");
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
function onSharedSettingsChanged(column, reread) {
	useBus().subscribe(CHANGED_CHANNEL, (change) => {
		if (change.column === column) reread();
	}).catch((error) => {
		useLogger().warn(error, "[shared-settings] no announcements will be heard; the settings are re-read on their own floor");
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
*
* The create as well as the update: a deployment nobody has saved a setting on
* yet has no singleton row, and the first write to it makes one.
*/
async function initSharedSettings() {
	const { default: emitter } = await import("../../emitter.js");
	for (const event of ["settings.create", "settings.update"]) emitter.onAction(event, ({ payload }) => {
		if (!payload) return;
		for (const column of Object.values(SHARED_SETTINGS_COLUMNS)) {
			if (column in payload === false) continue;
			useBus().publish(CHANGED_CHANNEL, { column }).catch((error) => {
				useLogger().warn(error, `[shared-settings] could not announce ${column}`);
			});
		}
	});
}

//#endregion
export { SHARED_SETTINGS_COLUMNS, asSharedSettings, initSharedSettings, onSharedSettingsChanged, readAllSharedSettings, readSharedSettings, sharedSettingsPollMs, writeSharedSettings };