import { getMilliseconds } from "./utils/get-milliseconds.js";
import { useLogger } from "./logger/index.js";
import { outstandingMigrations } from "./database/index.js";
import { useEnv } from "@directus/env";

//#region src/outstanding-migrations.ts
/**
* `undefined` while nothing has managed a reading yet. An instance that cannot
* tell whether the schema matches its own build must not report ready, so that
* state holds health down as a pending migration does.
*/
let outstanding = [];
let watching = false;
let stopped = false;
/**
* The outstanding migrations holding this instance unhealthy.
*
* Empty when nothing is — which is also what an instance that never held health
* reports, so embedding `createApp` alone keeps behaving as it did.
*/
function outstandingMigrationsHoldingHealth() {
	return outstanding;
}
/**
* Holds health down until a reading comes in, without touching the database.
*
* Separate from the watch so the server can be pessimistic from its very first
* instant while the polling waits for the connection to have been validated —
* otherwise the watch reports an unreachable database once a tick, drowning out
* the fatal error `createApp` is on its way to raising about the same thing.
*/
function holdHealthForOutstandingMigrations() {
	outstanding = void 0;
}
/** Lets the poll finish on shutdown rather than reading a torn-down pool. */
function stopWatchingOutstandingMigrations() {
	stopped = true;
}
/**
* Polls until the database has recorded every migration this build ships,
* leaving `/server/health` in error until it has. Returns once it knows, or
* once it has given up; callers start it without awaiting.
*
* Deliberately does not stop the server listening. A platform healthcheck fails
* a deploy on the error, which keeps the previous deployment serving; refusing
* the port would add nothing there and would take the service down on any
* restart landing while migrations are outstanding, with nothing watching.
*/
async function watchOutstandingMigrations() {
	if (watching || stopped) return;
	const env = useEnv();
	const logger = useLogger();
	const interval = getMilliseconds(env["MIGRATIONS_WAIT_INTERVAL"], 2e3);
	const timeout = getMilliseconds(env["MIGRATIONS_WAIT_TIMEOUT"], 3e5);
	const deadline = Date.now() + timeout;
	watching = true;
	holdHealthForOutstandingMigrations();
	while (!stopped) {
		try {
			outstanding = await outstandingMigrations();
		} catch (error) {
			outstanding = void 0;
			logger.warn(error, "Could not read the applied migrations, retrying");
		}
		if (outstanding?.length === 0) {
			logger.info("Database migrations are up to date");
			watching = false;
			return;
		}
		if (Date.now() >= deadline) {
			logger.error(`Database migrations have not all been run: ${outstanding?.join(", ") ?? "the database could not be read"}. Giving up after ${timeout}ms; this instance will report unhealthy until it is restarted.`);
			watching = false;
			return;
		}
		await new Promise((resolve) => {
			setTimeout(resolve, interval * (.5 + Math.random())).unref();
		});
	}
	watching = false;
}

//#endregion
export { holdHealthForOutstandingMigrations, outstandingMigrationsHoldingHealth, stopWatchingOutstandingMigrations, watchOutstandingMigrations };