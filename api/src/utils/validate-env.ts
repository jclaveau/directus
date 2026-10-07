import { useEnv } from '@directus/env';
import { parse as parseBytesConfiguration } from 'bytes';
import { useLogger } from '../logger/index.js';
import { getMilliseconds } from './get-milliseconds.js';

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

/**
 * Refuse a duration variable that is not a duration of 0 or more, the way
 * {@link validateBooleanEnv} refuses a boolean: at boot, before the server
 * listens, so a deployment carrying one fails its healthcheck and the one
 * before keeps the traffic.
 *
 * Read off `useEnv`, so an unset variable takes its default. `ms` reads a value
 * over 100 characters, 401 digits included, as none.
 */
export function validateDurationEnv(keys: string[]): void {
	const env = useEnv();
	const logger = useLogger();

	for (const key of keys) {
		const parsedMs = getMilliseconds(env[key]);

		if (parsedMs !== undefined && parsedMs >= 0) {
			continue;
		}

		logger.error(
			`"${key}" Environment Variable is ${JSON.stringify(env[key])}, `
				+ 'which is not a duration of 0 or more.',
		);

		process.exit(1);
	}
}

/**
 * Refuse a size variable that is not a size of 0 or more, at boot like
 * {@link validateDurationEnv}. Read off `useEnv`, so an unset variable takes its
 * default.
 */
export function validateBytesEnv(keys: string[]): void {
	const env = useEnv();
	const logger = useLogger();

	for (const key of keys) {
		const parsedBytes = parseBytesConfiguration(String(env[key]));

		if (parsedBytes !== null && parsedBytes >= 0) {
			continue;
		}

		logger.error(
			`"${key}" Environment Variable is ${JSON.stringify(env[key])}, `
				+ 'which is not a size of 0 or more.',
		);

		process.exit(1);
	}
}

/**
 * Refuse a variable set to none of `choices`, at boot like
 * {@link validateDurationEnv}. Read off `useEnv`, so an unset variable takes its
 * default.
 */
export function validateChoiceEnv(
	key: string,
	choices: readonly string[],
): void {
	const env = useEnv();

	if (choices.includes(env[key] as string)) {
		return;
	}

	useLogger().error(
		`"${key}" Environment Variable is ${JSON.stringify(env[key])}, `
			+ `which is not one of ${choices.join(', ')}.`,
	);

	process.exit(1);
}
