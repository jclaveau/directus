import { useEnv } from '@directus/env';
import { outstandingMigrations } from './database/index.js';
import { useLogger } from './logger/index.js';
import { getMilliseconds } from './utils/get-milliseconds.js';

/**
 * `undefined` while the watch is running but has not managed a reading yet. An
 * instance that cannot tell whether the schema matches its own build must not
 * report ready, so that state holds health down as a pending migration does.
 */
let outstanding: string[] | undefined = [];

/**
 * The outstanding migrations holding this instance unhealthy.
 *
 * Empty when nothing is — which is also what an instance that never started the
 * watch reports, so embedding `createApp` alone keeps behaving as it did.
 */
export function outstandingMigrationsHoldingHealth(): string[] | undefined {
	return outstanding;
}

/**
 * Polls until the database has recorded every migration this build ships, leaving
 * `/server/health` in error until it has. Returns once it knows, or once it has
 * given up; callers start it without awaiting.
 *
 * Deliberately does not stop the server listening. A platform healthcheck fails a
 * deploy on the error, which keeps the previous deployment serving; refusing the
 * port would add nothing there and would take the service down on any restart
 * landing while migrations are outstanding, with nothing watching to put it back.
 */
export async function watchOutstandingMigrations(): Promise<void> {
	const env = useEnv();
	const logger = useLogger();

	const interval = getMilliseconds(env['MIGRATIONS_WAIT_INTERVAL'], 2000);

	const deadline =
		Date.now() + getMilliseconds(env['MIGRATIONS_WAIT_TIMEOUT'], 300000);

	outstanding = undefined;

	while (true) {
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
			return;
		}

		if (Date.now() >= deadline) {
			logger.error(
				`Database migrations have not all been run:`
					+ ` ${outstanding?.join(', ') ?? 'the database could not be read'}.`
					+ ` Giving up after ${env['MIGRATIONS_WAIT_TIMEOUT']}; this instance`
					+ ` will report unhealthy until it is restarted.`,
			);

			return;
		}

		// Jittered so cluster workers do not converge on the same instant while
		// the database is busy applying the migrations they are waiting for.
		await new Promise((resolve) => {
			setTimeout(resolve, interval * (0.5 + Math.random())).unref();
		});
	}
}
