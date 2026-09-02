import { useEnv } from '@directus/env';
import { outstandingMigrations } from './database/index.js';
import { useLogger } from './logger/index.js';
import { getMilliseconds } from './utils/get-milliseconds.js';

/**
 * `undefined` while nothing has managed a reading yet. An instance that cannot
 * tell whether the schema matches its own build must not report ready, so that
 * state holds health down as a pending migration does.
 */
let outstanding: string[] | undefined = [];

let watching = false;
let stopped = false;

/**
 * The outstanding migrations holding this instance unhealthy.
 *
 * Empty when nothing is — which is also what an instance that never held health
 * reports, so embedding `createApp` alone keeps behaving as it did.
 */
export function outstandingMigrationsHoldingHealth(): string[] | undefined {
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
// eslint-disable-next-line local/no-single-caller-function -- server.ts calls it
export function holdHealthForOutstandingMigrations(): void {
	outstanding = undefined;
}

/** Lets the poll finish on shutdown rather than reading a torn-down pool. */
export function stopWatchingOutstandingMigrations(): void {
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
export async function watchOutstandingMigrations(): Promise<void> {
	if (watching || stopped) {
		// Returning before the hold matters: flipping health to unknown with no
		// loop left to clear it would strand the instance unhealthy for good.
		return;
	}

	const env = useEnv();
	const logger = useLogger();

	const interval = getMilliseconds(env['MIGRATIONS_WAIT_INTERVAL'], 2000);
	const timeout = getMilliseconds(env['MIGRATIONS_WAIT_TIMEOUT'], 300000);
	const deadline = Date.now() + timeout;

	watching = true;
	holdHealthForOutstandingMigrations();

	while (!stopped) {
		try {
			outstanding = await outstandingMigrations();
		}
		catch (error) {
			// Transient while another service is mid-migration. Health stays down
			// because the reading is unknown, and the next tick tries again.
			outstanding = undefined;
			logger.warn(error, 'Could not read the applied migrations, retrying');
		}

		if (outstanding?.length === 0) {
			logger.info('Database migrations are up to date');
			watching = false;
			return;
		}

		if (Date.now() >= deadline) {
			logger.error(
				`Database migrations have not all been run:`
					+ ` ${outstanding?.join(', ') ?? 'the database could not be read'}.`
					+ ` Giving up after ${timeout}ms; this instance will report`
					+ ` unhealthy until it is restarted.`,
			);

			watching = false;
			return;
		}

		// Jittered so cluster workers do not converge on the same instant while
		// the database is busy applying the migrations they are waiting for.
		await new Promise((resolve) => {
			setTimeout(resolve, interval * (0.5 + Math.random())).unref();
		});
	}

	watching = false;
}
