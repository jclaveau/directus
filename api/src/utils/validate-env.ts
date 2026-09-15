import { useEnv } from '@directus/env';
import { useLogger } from '../logger/index.js';

export function validateEnv(requiredKeys: string[]): void {
	const env = useEnv();
	const logger = useLogger();

	for (const requiredKey of requiredKeys) {
		if (requiredKey in env === false) {
			logger.error(`"${requiredKey}" Environment Variable is missing.`);
			process.exit(1);
		}
	}
}

/**
 * What `toBoolean` reads as a boolean, spelled the ways an environment spells
 * one.
 */
const BOOLEANS = ['true', 'false', '1', '0'];

/**
 * Refuse a boolean variable set to something that is not one.
 *
 * `toBoolean` reads anything outside {@link BOOLEANS} as `false`, so a
 * deployment that meant `TRUE` turns a feature off and says nothing — and
 * `PM2_AUTOSCALE_ENABLED` turning off silently is a pool that never grows
 * under a load it was sized to answer.
 *
 * Read off `process.env` rather than off `useEnv`, which is where the cast has
 * already happened: by then a typo and a deliberate `false` are the same
 * value. A configuration file may hold a real boolean, and that is not read
 * here — a variable is a string, and a string is where the typo lands.
 *
 * Ends the process like the check above it: the value is read once at boot, so
 * refusing it costs a deployment that is already misconfigured, while taking
 * it costs an incident nobody can see the cause of.
 */
export function validateBooleanEnv(keys: string[]): void {
	const logger = useLogger();

	for (const key of keys) {
		const value = process.env[key];

		if (value === undefined || BOOLEANS.includes(value)) {
			continue;
		}

		logger.error(
			`"${key}" Environment Variable is ${JSON.stringify(value)}, `
				+ `which is not a boolean. Use one of ${BOOLEANS.join(', ')}.`,
		);

		process.exit(1);
	}
}
