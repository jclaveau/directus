import run from '../../../database/migrations/run.js';
import getDatabase from '../../../database/index.js';
import {
	getExtensionMigrations,
} from '../../../extensions/lib/get-extension-migrations.js';
import { useLogger } from '../../../logger/index.js';
import { migrateLatest } from '../../utils/migrate-latest.js';

export default async function migrate(
	direction: 'latest' | 'up' | 'down',
	options: { snapshot?: string; phase?: string } = {},
): Promise<void> {
	const database = getDatabase();
	const logger = useLogger();

	try {
		logger.info('Running migrations...');

		if (direction === 'latest') {
			await migrateLatest(database, options.snapshot);
		}
		else {
			await run(database, direction, true, {
				extensionMigrations: await getExtensionMigrations(),
			});
		}

		if (direction === 'down') {
			logger.info('Downgrade successful');
		} else {
			logger.info('Database up to date');
		}

		database.destroy();
		process.exit();
	} catch (err: any) {
		logger.error(err);
		database.destroy();
		process.exit(1);
	}
}
