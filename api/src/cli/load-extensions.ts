import { useEnv } from '@directus/env';
import type { ExtensionMigration } from '../database/migrations/list.js';
import { isInstalled, outstandingMigrationsOrExit } from '../database/index.js';
import { getExtensionManager } from '../extensions/index.js';
import {
	getExtensionMigrations,
} from '../extensions/lib/get-extension-migrations.js';
import { useLogger } from '../logger/index.js';

export const loadExtensions = async () => {
	const env = useEnv();
	const logger = useLogger();

	if (!('DB_CLIENT' in env)) return;

	const installed = await isInstalled();

	if (!installed) return;

	// The after-schema migrations wait on a snapshot the CLI may be about to
	// apply, so they do not keep the extensions from loading.
	const outstanding = await outstandingMigrationsOrExit(
		await readBeforeSchemaMigrations(),
	);

	if (outstanding.length > 0) {
		logger.info('Skipping CLI extensions initialization due to outstanding migrations.');
		return;
	}

	const extensionManager = getExtensionManager();
	await extensionManager.initialize({ schedule: false, watch: false });
};

async function readBeforeSchemaMigrations(): Promise<ExtensionMigration[]> {
	try {
		const extensionMigrations = await getExtensionMigrations();

		return extensionMigrations.filter(
			({ config }) => config.phase !== 'after-schema',
		);
	}
	catch (error) {
		// The manager imports the bundle again and reports the failure its own way.
		useLogger().warn(error, 'Could not read the migrations of the bundles');

		return [];
	}
}
