import { useEnv } from '@directus/env';
import { parse as parseBytesConfiguration } from 'bytes';
import { validateHeaderName } from 'node:http';
import { useLogger } from '../logger/index.js';
import { getMilliseconds } from './get-milliseconds.js';
import {
	allowedOutOfScopeFeatures,
	OUT_OF_SCOPE_FEATURES,
} from './out-of-scope-features.js';

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
 * Refuse a count variable that is not a whole number of 0 or more, at boot like
 * {@link validateDurationEnv}. Read off `useEnv`, so an unset variable takes its
 * default; TYPE_MAP types it a number, which reads `ten` as NaN.
 */
export function validateCountEnv(keys: string[]): void {
	const env = useEnv();
	const logger = useLogger();

	for (const key of keys) {
		const countValue = env[key];

		if (Number.isSafeInteger(countValue) && (countValue as number) >= 0) {
			continue;
		}

		logger.error(
			`"${key}" Environment Variable is ${JSON.stringify(String(countValue))}, `
				+ 'which is not a whole number of 0 or more.',
		);

		process.exit(1);
	}
}

/**
 * A number of bytes, or of a unit `bytes` knows. Checked before parsing:
 * `bytes` reads what follows the leading digits as nothing, `16k` as 16.
 */
const SIZE_PATTERN = /^\d+(?:\.\d+)?\s*(?:b|kb|mb|gb|tb|pb)?$/i;

/**
 * Refuse a size variable that is not a size of 0 or more, nor 0 or
 * `nonzeroMinimum` bytes or more when given, at boot like
 * {@link validateDurationEnv}. Read off `useEnv`, so an unset variable takes its
 * default.
 */
export function validateBytesEnv(keys: string[], nonzeroMinimum = 0): void {
	const env = useEnv();
	const logger = useLogger();

	for (const key of keys) {
		const sizeValue = String(env[key]);

		const parsedBytes = SIZE_PATTERN.test(sizeValue)
			? parseBytesConfiguration(sizeValue)
			: null;

		if (parsedBytes === null) {
			logger.error(
				`"${key}" Environment Variable is ${JSON.stringify(env[key])}, `
					+ 'which is not a size of 0 or more.',
			);

			process.exit(1);
		}
		else if (parsedBytes > 0 && parsedBytes < nonzeroMinimum) {
			logger.error(
				`"${key}" Environment Variable is ${JSON.stringify(env[key])}, `
					+ `which is neither 0 nor a size of ${nonzeroMinimum} bytes or more.`,
			);

			process.exit(1);
		}
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

/** The `DB_CLIENT` values of the MS SQL Server and Oracle code this fork dropped. */
const DROPPED_DATABASE_CLIENTS = ['mssql', 'oracledb', 'oracle'];

const SUPPORTED_DATABASE_CLIENTS = [
	'pg',
	'cockroachdb',
	'mysql',
	'sqlite3',
	'redshift',
];

/**
 * Refuse a client variable naming a dropped dialect, at boot like
 * {@link validateDurationEnv}: its driver is no longer installed, and knex
 * would only say to install it.
 */
export function validateDatabaseClientEnv(keys: string[]): void {
	const env = useEnv();

	for (const key of keys) {
		if (DROPPED_DATABASE_CLIENTS.includes(env[key] as string) === false) {
			continue;
		}

		useLogger().error(
			`${JSON.stringify(key)} Environment Variable is `
				+ `${JSON.stringify(env[key])}, which this build does not support: `
				+ `use one of ${SUPPORTED_DATABASE_CLIENTS.join(', ')}.`,
		);

		process.exit(1);
	}
}

/**
 * Refuse a variable naming a response header Node cannot write, which would
 * otherwise fail every response, at boot like {@link validateDurationEnv}. A
 * boolean is refused too: the variable turns its feature on by being set, so
 * `false` would turn it on under a header named `false`.
 */
export function validateHeaderNameEnv(key: string): void {
	const env = useEnv();

	if (BOOLEANS.includes(String(env[key]).toLowerCase())) {
		useLogger().error(
			`"${key}" Environment Variable is ${JSON.stringify(env[key])}, `
				+ 'which reads as a boolean, not a header name: leave it unset '
				+ 'to send none.',
		);

		process.exit(1);
	}

	try {
		validateHeaderName(String(env[key]));
	}
	catch {
		useLogger().error(
			`"${key}" Environment Variable is ${JSON.stringify(env[key])}, `
				+ 'which is not a valid header name.',
		);

		process.exit(1);
	}
}

const UNREAD_VARIABLE_ADVICE: Record<string, string> = {
	EXTENSIONS_PATH: 'extensions load only as the dependencies of the'
		+ ' package.json in PACKAGE_FILE_LOCATION. Unset it.',
};

/**
 * Refuse a variable this build does not read, set by a deployment configured
 * for one that did.
 */
export function validateUnreadEnv(): void {
	const env = useEnv();

	for (const [key, advice] of Object.entries(UNREAD_VARIABLE_ADVICE)) {
		if (env[key] === undefined) {
			continue;
		}

		useLogger().error(
			`${JSON.stringify(key)} Environment Variable is `
				+ `${JSON.stringify(env[key])}, which this build does not read: `
				+ `${advice}`,
		);

		process.exit(1);
	}
}

/**
 * Refuse `EXTENSIONS_AUTO_MIGRATE` where it cannot do what it says: it migrates
 * on a watcher-triggered reload, so it needs `EXTENSIONS_AUTO_RELOAD`, and it
 * applies a bundle's schema changes unreviewed, which production must not.
 */
export function validateAutoMigrateEnv(): void {
	const env = useEnv();

	validateBooleanEnv(['EXTENSIONS_AUTO_MIGRATE']);

	if (env['EXTENSIONS_AUTO_MIGRATE'] !== true) {
		return;
	}

	const nodeEnv = process.env['NODE_ENV'] || 'production';

	if (nodeEnv === 'production') {
		useLogger().error(
			'"EXTENSIONS_AUTO_MIGRATE" Environment Variable is true while'
				+ ` NODE_ENV is ${JSON.stringify(nodeEnv)}: production runs the`
				+ ' migrations of its bundles with "directus database migrate:latest".',
		);

		process.exit(1);
	}

	if (env['EXTENSIONS_AUTO_RELOAD'] !== true) {
		useLogger().error(
			'"EXTENSIONS_AUTO_MIGRATE" Environment Variable is true while'
				+ ' "EXTENSIONS_AUTO_RELOAD" is not: it migrates on the reload a'
				+ ' change in a bundle triggers.',
		);

		process.exit(1);
	}
}

/**
 * Refuse `MARKETPLACE_ENABLED=true` in production: there extensions change only
 * with a deploy (#627), so the variable closes the Marketplace elsewhere, never
 * opens it there.
 */
export function validateMarketplaceEnabledEnv(): void {
	validateBooleanEnv(['MARKETPLACE_ENABLED']);

	if (useEnv()['MARKETPLACE_ENABLED'] !== true) {
		return;
	}

	const nodeEnv = process.env['NODE_ENV'] || 'production';

	if (nodeEnv === 'production') {
		useLogger().error(
			'"MARKETPLACE_ENABLED" Environment Variable is true while NODE_ENV is'
				+ ` ${JSON.stringify(nodeEnv)}: production changes its extensions`
				+ ' only with a deploy.',
		);

		process.exit(1);
	}
}

/**
 * Refuse a deployment turning on an out-of-scope feature it did not name in
 * `OUT_OF_SCOPE_FEATURES_ALLOWED`, at boot like {@link validateDurationEnv}:
 * untested code then runs only by choice, never by an inherited variable.
 * Refusing at boot rather than in the feature's own code leaves no request
 * half done, and keeps the refusal in one place blackbox can test.
 */
export function validateOutOfScopeFeaturesEnv(): void {
	const env = useEnv();
	const knownFeatures = Object.keys(OUT_OF_SCOPE_FEATURES);

	const allowedFeatures = allowedOutOfScopeFeatures();

	const refusalMessages = allowedFeatures
		.filter((feature) => knownFeatures.includes(feature) === false)
		.map((feature) => {
			return '"OUT_OF_SCOPE_FEATURES_ALLOWED" Environment Variable names '
				+ `${JSON.stringify(feature)}, which is not one of `
				+ `${knownFeatures.join(', ')}.`;
		});

	const usedFeatures: { key: string; value: unknown; feature: string }[] = [];

	for (const providerName of String(env['AUTH_PROVIDERS'] ?? '').split(',')) {
		const trimmedName = providerName.trim();

		if (trimmedName === '') {
			continue;
		}

		const driverKey = `AUTH_${trimmedName.toUpperCase()}_DRIVER`;
		const driverName = String(env[driverKey]);

		if (driverName in OUT_OF_SCOPE_FEATURES) {
			usedFeatures.push({
				key: driverKey,
				value: driverName,
				feature: driverName,
			});
		}
	}

	// The GraphQL controller is only built on a server serving websockets.
	if (
		env['WEBSOCKETS_ENABLED'] === true
		&& env['WEBSOCKETS_GRAPHQL_ENABLED'] === true
	) {
		usedFeatures.push({
			key: 'WEBSOCKETS_GRAPHQL_ENABLED',
			value: true,
			feature: 'websockets-graphql',
		});
	}

	if (env['EXTENSIONS_AUTO_RELOAD'] === true) {
		usedFeatures.push({
			key: 'EXTENSIONS_AUTO_RELOAD',
			value: true,
			feature: 'extensions-auto-reload',
		});
	}

	for (const { key, value, feature } of usedFeatures) {
		if (allowedFeatures.includes(feature)) {
			continue;
		}

		refusalMessages.push(
			`${JSON.stringify(key)} Environment Variable is `
				+ `${JSON.stringify(value)}, a feature out of the tested scope `
				+ `(${OUT_OF_SCOPE_FEATURES[feature]}): add `
				+ `${JSON.stringify(feature)} to OUT_OF_SCOPE_FEATURES_ALLOWED `
				+ 'to run it untested.',
		);
	}

	if (refusalMessages.length === 0) {
		return;
	}

	for (const refusalMessage of refusalMessages) {
		useLogger().error(refusalMessage);
	}

	process.exit(1);
}
