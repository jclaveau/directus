import { useEnv } from '@directus/env';
import type { Logger } from 'pino';
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from 'vitest';
import { useLogger } from '../logger/index.js';
import {
	validateAutoMigrateEnv,
	validateBytesEnv,
	validateChoiceEnv,
	validateCountEnv,
	validateDatabaseClientEnv,
	validateDurationEnv,
	validateEnv,
	validateHeaderNameEnv,
	validateMarketplaceEnabledEnv,
	validateOutOfScopeFeaturesEnv,
	validateUnreadEnv,
} from './validate-env.js';

vi.mock('@directus/env');

vi.mock('../logger');

let mockLogger: Logger<never>;

beforeAll(() => {
	vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

	vi.mocked(useEnv, { partial: true }).mockReturnValue({
		PUBLIC_URL: 'true',
	});
});

beforeEach(() => {
	mockLogger = {
		error: vi.fn(),
	} as unknown as Logger<never>;

	vi.mocked(useLogger).mockReturnValue(mockLogger);
});

afterEach(() => {
	vi.clearAllMocks();
});

test('should not have any error when key is present', () => {
	validateEnv(['PUBLIC_URL']);

	expect(mockLogger.error).not.toHaveBeenCalled();
	expect(process.exit).not.toHaveBeenCalled();
});

test('should have error when key is missing', () => {
	validateEnv(['ABSENT_TEST_VARIABLE']);

	expect(mockLogger.error).toHaveBeenCalled();
	expect(process.exit).toHaveBeenCalled();
});

// Taking one would open no fill pause, and a new build would fill beside the
// build before.
test.each([
	{
		value: '-5m',
		message: '"CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX" Environment Variable is "-5m", '
			+ 'which is not a duration of 0 or more.',
	},
	{
		value: 'five minutes',
		message: '"CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX" Environment Variable is '
			+ '"five minutes", which is not a duration of 0 or more.',
	},
	{
		value: `1${'0'.repeat(400)}`,
		message: '"CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX" Environment Variable is '
			+ `"1${'0'.repeat(400)}", which is not a duration of 0 or more.`,
	},
])('refuses the duration $value', ({ value, message }) => {
	vi.mocked(useEnv, { partial: true })
		.mockReturnValueOnce({ CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX: value });

	validateDurationEnv(['CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX']);

	expect(mockLogger.error).toHaveBeenCalledExactlyOnceWith(message);
	expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
});

test.each(['0', '5m', '4.1m'])('takes the duration %j', (value) => {
	vi.mocked(useEnv, { partial: true })
		.mockReturnValueOnce({ CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX: value });

	validateDurationEnv(['CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX']);

	expect(mockLogger.error).not.toHaveBeenCalled();
	expect(process.exit).not.toHaveBeenCalled();
});

test.each([
	{
		value: '-1kb',
		message: '"QUERY_AUDIT_HEADER_MAX_SIZE" Environment Variable is "-1kb", '
			+ 'which is not a size of 0 or more.',
	},
	{
		value: 'eight kilobytes',
		message: '"QUERY_AUDIT_HEADER_MAX_SIZE" Environment Variable is '
			+ '"eight kilobytes", which is not a size of 0 or more.',
	},
	{
		value: '16k',
		message: '"QUERY_AUDIT_HEADER_MAX_SIZE" Environment Variable is "16k", '
			+ 'which is not a size of 0 or more.',
	},
	{
		value: '8KiB',
		message: '"QUERY_AUDIT_HEADER_MAX_SIZE" Environment Variable is "8KiB", '
			+ 'which is not a size of 0 or more.',
	},
	{
		value: '8,192',
		message: '"QUERY_AUDIT_HEADER_MAX_SIZE" Environment Variable is "8,192", '
			+ 'which is not a size of 0 or more.',
	},
	{
		value: '12abc',
		message: '"QUERY_AUDIT_HEADER_MAX_SIZE" Environment Variable is "12abc", '
			+ 'which is not a size of 0 or more.',
	},
	{
		value: '1e3',
		message: '"QUERY_AUDIT_HEADER_MAX_SIZE" Environment Variable is "1e3", '
			+ 'which is not a size of 0 or more.',
	},
])('refuses the size $value', ({ value, message }) => {
	vi.mocked(useEnv, { partial: true })
		.mockReturnValueOnce({ QUERY_AUDIT_HEADER_MAX_SIZE: value });

	validateBytesEnv(['QUERY_AUDIT_HEADER_MAX_SIZE']);

	expect(mockLogger.error).toHaveBeenCalledExactlyOnceWith(message);
	expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
});

test.each(['0', '8kb', '512', '1.5mb', '8 KB'])('takes the size %j', (value) => {
	vi.mocked(useEnv, { partial: true })
		.mockReturnValueOnce({ QUERY_AUDIT_HEADER_MAX_SIZE: value });

	validateBytesEnv(['QUERY_AUDIT_HEADER_MAX_SIZE']);

	expect(mockLogger.error).not.toHaveBeenCalled();
	expect(process.exit).not.toHaveBeenCalled();
});

test('refuses a size below the minimum other than 0', () => {
	vi.mocked(useEnv, { partial: true })
		.mockReturnValueOnce({ QUERY_AUDIT_HEADER_MAX_SIZE: '255' });

	validateBytesEnv(['QUERY_AUDIT_HEADER_MAX_SIZE'], 256);

	expect(mockLogger.error).toHaveBeenCalledExactlyOnceWith(
		'"QUERY_AUDIT_HEADER_MAX_SIZE" Environment Variable is "255", '
			+ 'which is neither 0 nor a size of 256 bytes or more.',
	);

	expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
});

test.each(['0', '256', '1kb'])('takes the size %j past the minimum', (value) => {
	vi.mocked(useEnv, { partial: true })
		.mockReturnValueOnce({ QUERY_AUDIT_HEADER_MAX_SIZE: value });

	validateBytesEnv(['QUERY_AUDIT_HEADER_MAX_SIZE'], 256);

	expect(mockLogger.error).not.toHaveBeenCalled();
	expect(process.exit).not.toHaveBeenCalled();
});

test.each([
	{
		value: -1,
		message: '"CACHE_SCOPED_MAX_ON_DELETE_ROWS" Environment Variable is "-1", '
			+ 'which is not a whole number of 0 or more.',
	},
	{
		value: 2.5,
		message: '"CACHE_SCOPED_MAX_ON_DELETE_ROWS" Environment Variable is "2.5", '
			+ 'which is not a whole number of 0 or more.',
	},
	{
		value: Number.NaN,
		message: '"CACHE_SCOPED_MAX_ON_DELETE_ROWS" Environment Variable is "NaN", '
			+ 'which is not a whole number of 0 or more.',
	},
	{
		value: 'ten',
		message: '"CACHE_SCOPED_MAX_ON_DELETE_ROWS" Environment Variable is "ten", '
			+ 'which is not a whole number of 0 or more.',
	},
])('refuses the count $value', ({ value, message }) => {
	vi.mocked(useEnv, { partial: true })
		// @ts-expect-error a raw env can hold "ten", the declared number refuses it
		.mockReturnValueOnce({ CACHE_SCOPED_MAX_ON_DELETE_ROWS: value });

	validateCountEnv(['CACHE_SCOPED_MAX_ON_DELETE_ROWS']);

	expect(mockLogger.error).toHaveBeenCalledExactlyOnceWith(message);
	expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
});

test.each([0, 1000])('takes the count %j', (value) => {
	vi.mocked(useEnv, { partial: true })
		.mockReturnValueOnce({ CACHE_SCOPED_MAX_ON_DELETE_ROWS: value });

	validateCountEnv(['CACHE_SCOPED_MAX_ON_DELETE_ROWS']);

	expect(mockLogger.error).not.toHaveBeenCalled();
	expect(process.exit).not.toHaveBeenCalled();
});

test('refuses a choice outside the list', () => {
	vi.mocked(useEnv, { partial: true })
		.mockReturnValueOnce({ QUERY_AUDIT_LEVEL: 'every' });

	validateChoiceEnv('QUERY_AUDIT_LEVEL', ['counts', 'full']);

	expect(mockLogger.error).toHaveBeenCalledExactlyOnceWith(
		'"QUERY_AUDIT_LEVEL" Environment Variable is "every", '
			+ 'which is not one of counts, full.',
	);

	expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
});

test('takes a choice from the list', () => {
	vi.mocked(useEnv, { partial: true })
		.mockReturnValueOnce({ QUERY_AUDIT_LEVEL: 'full' });

	validateChoiceEnv('QUERY_AUDIT_LEVEL', ['counts', 'full']);

	expect(mockLogger.error).not.toHaveBeenCalled();
	expect(process.exit).not.toHaveBeenCalled();
});

// Node throws on every `setHeader` of such a name: every response would fail.
test('refuses a header name Node cannot write', () => {
	vi.mocked(useEnv, { partial: true })
		.mockReturnValueOnce({ QUERY_AUDIT_HEADER: 'x query audit' });

	validateHeaderNameEnv('QUERY_AUDIT_HEADER');

	expect(mockLogger.error).toHaveBeenCalledExactlyOnceWith(
		'"QUERY_AUDIT_HEADER" Environment Variable is "x query audit", '
			+ 'which is not a valid header name.',
	);

	expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
});

// A boolean would turn the audit on under a header of that name.
test.each(['false', 'true', 'FALSE', '0', '1'])(
	'refuses a header name that reads as the boolean %j',
	(value) => {
		vi.mocked(useEnv, { partial: true })
			.mockReturnValueOnce({ QUERY_AUDIT_HEADER: value });

		validateHeaderNameEnv('QUERY_AUDIT_HEADER');

		expect(mockLogger.error).toHaveBeenCalledExactlyOnceWith(
			`"QUERY_AUDIT_HEADER" Environment Variable is "${value}", `
				+ 'which reads as a boolean, not a header name: leave it unset '
				+ 'to send none.',
		);

		expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
	},
);

test('takes a header name Node can write', () => {
	vi.mocked(useEnv, { partial: true })
		.mockReturnValueOnce({ QUERY_AUDIT_HEADER: 'X-Query-Audit' });

	validateHeaderNameEnv('QUERY_AUDIT_HEADER');

	expect(mockLogger.error).not.toHaveBeenCalled();
	expect(process.exit).not.toHaveBeenCalled();
});

test('refuses EXTENSIONS_PATH, which this build does not read', () => {
	vi.mocked(useEnv, { partial: true })
		.mockReturnValueOnce({ EXTENSIONS_PATH: './extensions' });

	validateUnreadEnv();

	expect(mockLogger.error).toHaveBeenCalledWith(
		'"EXTENSIONS_PATH" Environment Variable is "./extensions", which this'
			+ ' build does not read: extensions load only as the dependencies of'
			+ ' the package.json in PACKAGE_FILE_LOCATION. Unset it.',
	);

	expect(process.exit).toHaveBeenCalledWith(1);
});

test('passes an environment without EXTENSIONS_PATH', () => {
	vi.mocked(useEnv, { partial: true })
		.mockReturnValueOnce({ PACKAGE_FILE_LOCATION: '.' });

	validateUnreadEnv();

	expect(mockLogger.error).not.toHaveBeenCalled();
	expect(process.exit).not.toHaveBeenCalled();
});

describe('validateDatabaseClientEnv', () => {
	test.each(['mssql', 'oracledb', 'oracle'])(
		'refuses the dropped client %j',
		(client) => {
			vi.mocked(useEnv).mockReturnValueOnce({ DB_CLIENT: client });

			validateDatabaseClientEnv(['DB_CLIENT']);

			expect(mockLogger.error).toHaveBeenCalledExactlyOnceWith(
				`"DB_CLIENT" Environment Variable is ${JSON.stringify(client)}, `
					+ 'which this build does not support: use one of pg, '
					+ 'cockroachdb, mysql, sqlite3, redshift.',
			);

			expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
		},
	);

	test('refuses a dropped client on a named connection', () => {
		vi.mocked(useEnv).mockReturnValueOnce({
			DB_CLIENT: 'pg',
			DB_CONNECTION_REPORTS_CLIENT: 'mssql',
		});

		validateDatabaseClientEnv(['DB_CLIENT', 'DB_CONNECTION_REPORTS_CLIENT']);

		expect(mockLogger.error).toHaveBeenCalledExactlyOnceWith(
			'"DB_CONNECTION_REPORTS_CLIENT" Environment Variable is "mssql", '
				+ 'which this build does not support: use one of pg, '
				+ 'cockroachdb, mysql, sqlite3, redshift.',
		);

		expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	test.each(['pg', 'postgres', 'mysql', 'mysql2', 'sqlite3', 'cockroachdb'])(
		'passes the client %j',
		(client) => {
			vi.mocked(useEnv).mockReturnValueOnce({ DB_CLIENT: client });

			validateDatabaseClientEnv(['DB_CLIENT']);

			expect(mockLogger.error).not.toHaveBeenCalled();
			expect(process.exit).not.toHaveBeenCalled();
		},
	);
});

describe('validateAutoMigrateEnv', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	test('refuses it in production', () => {
		vi.stubEnv('NODE_ENV', 'production');

		vi.mocked(useEnv, { partial: true }).mockReturnValueOnce({
			EXTENSIONS_AUTO_MIGRATE: true,
			EXTENSIONS_AUTO_RELOAD: true,
		});

		validateAutoMigrateEnv();

		expect(mockLogger.error).toHaveBeenCalledWith(
			'"EXTENSIONS_AUTO_MIGRATE" Environment Variable is true while'
				+ ' NODE_ENV is "production": production runs the migrations of'
				+ ' its bundles with "directus database migrate:latest".',
		);

		expect(process.exit).toHaveBeenCalledWith(1);
	});

	test('refuses it without EXTENSIONS_AUTO_RELOAD', () => {
		vi.stubEnv('NODE_ENV', 'development');

		vi.mocked(useEnv, { partial: true }).mockReturnValueOnce({
			EXTENSIONS_AUTO_MIGRATE: true,
			EXTENSIONS_AUTO_RELOAD: false,
		});

		validateAutoMigrateEnv();

		expect(mockLogger.error).toHaveBeenCalledWith(
			'"EXTENSIONS_AUTO_MIGRATE" Environment Variable is true while'
				+ ' "EXTENSIONS_AUTO_RELOAD" is not: it migrates on the reload a'
				+ ' change in a bundle triggers.',
		);

		expect(process.exit).toHaveBeenCalledWith(1);
	});

	test('takes it in development with EXTENSIONS_AUTO_RELOAD', () => {
		vi.stubEnv('NODE_ENV', 'development');

		vi.mocked(useEnv, { partial: true }).mockReturnValueOnce({
			EXTENSIONS_AUTO_MIGRATE: true,
			EXTENSIONS_AUTO_RELOAD: true,
		});

		validateAutoMigrateEnv();

		expect(mockLogger.error).not.toHaveBeenCalled();
		expect(process.exit).not.toHaveBeenCalled();
	});

	test('takes it off in production', () => {
		vi.stubEnv('NODE_ENV', 'production');

		vi.mocked(useEnv, { partial: true })
			.mockReturnValueOnce({ EXTENSIONS_AUTO_MIGRATE: false });

		validateAutoMigrateEnv();

		expect(mockLogger.error).not.toHaveBeenCalled();
		expect(process.exit).not.toHaveBeenCalled();
	});
});

describe('validateMarketplaceEnabledEnv', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	test('refuses true in production', () => {
		vi.stubEnv('NODE_ENV', 'production');

		vi.mocked(useEnv, { partial: true })
			.mockReturnValueOnce({ MARKETPLACE_ENABLED: true });

		validateMarketplaceEnabledEnv();

		expect(mockLogger.error).toHaveBeenCalledWith(
			'"MARKETPLACE_ENABLED" Environment Variable is true while NODE_ENV is'
				+ ' "production": production changes its extensions only with a'
				+ ' deploy.',
		);

		expect(process.exit).toHaveBeenCalledWith(1);
	});

	test('refuses true with NODE_ENV unset', () => {
		vi.stubEnv('NODE_ENV', '');

		vi.mocked(useEnv, { partial: true })
			.mockReturnValueOnce({ MARKETPLACE_ENABLED: true });

		validateMarketplaceEnabledEnv();

		expect(mockLogger.error).toHaveBeenCalledWith(
			'"MARKETPLACE_ENABLED" Environment Variable is true while NODE_ENV is'
				+ ' "production": production changes its extensions only with a'
				+ ' deploy.',
		);

		expect(process.exit).toHaveBeenCalledWith(1);
	});

	test('takes false in production', () => {
		vi.stubEnv('NODE_ENV', 'production');

		vi.mocked(useEnv, { partial: true })
			.mockReturnValueOnce({ MARKETPLACE_ENABLED: false });

		validateMarketplaceEnabledEnv();

		expect(process.exit).not.toHaveBeenCalled();
	});

	test('takes true in development', () => {
		vi.stubEnv('NODE_ENV', 'development');

		vi.mocked(useEnv, { partial: true })
			.mockReturnValueOnce({ MARKETPLACE_ENABLED: true });

		validateMarketplaceEnabledEnv();

		expect(process.exit).not.toHaveBeenCalled();
	});
});

describe('validateOutOfScopeFeaturesEnv', () => {
	test('refuses an ldap auth driver left out of the allowed list', () => {
		vi.mocked(useEnv).mockReturnValue({
			AUTH_PROVIDERS: 'corp',
			AUTH_CORP_DRIVER: 'ldap',
			OUT_OF_SCOPE_FEATURES_ALLOWED: [],
		});

		validateOutOfScopeFeaturesEnv();

		expect(mockLogger.error).toHaveBeenCalledWith(
			'"AUTH_CORP_DRIVER" Environment Variable is "ldap", a feature out of'
				+ ' the tested scope (#619): add "ldap" to'
				+ ' OUT_OF_SCOPE_FEATURES_ALLOWED to run it untested.',
		);

		expect(process.exit).toHaveBeenCalledWith(1);
	});

	test('takes an ldap auth driver named in the allowed list', () => {
		vi.mocked(useEnv).mockReturnValue({
			AUTH_PROVIDERS: 'corp',
			AUTH_CORP_DRIVER: 'ldap',
			OUT_OF_SCOPE_FEATURES_ALLOWED: [' ldap'],
		});

		validateOutOfScopeFeaturesEnv();

		expect(mockLogger.error).not.toHaveBeenCalled();
		expect(process.exit).not.toHaveBeenCalled();
	});

	test('takes the local driver and an empty provider list', () => {
		vi.mocked(useEnv).mockReturnValue({
			AUTH_PROVIDERS: 'own,',
			AUTH_OWN_DRIVER: 'local',
		});

		validateOutOfScopeFeaturesEnv();

		expect(mockLogger.error).not.toHaveBeenCalled();
		expect(process.exit).not.toHaveBeenCalled();
	});

	test('leaves an auth driver that is no feature to the auth setup', () => {
		vi.mocked(useEnv).mockReturnValue({
			AUTH_PROVIDERS: 'corp,own',
			AUTH_CORP_DRIVER: 'shares',
			AUTH_OWN_DRIVER: 'constructor',
			OUT_OF_SCOPE_FEATURES_ALLOWED: [],
		});

		validateOutOfScopeFeaturesEnv();

		expect(mockLogger.error).not.toHaveBeenCalled();
		expect(process.exit).not.toHaveBeenCalled();
	});

	test('refuses the GraphQL websocket on a server serving websockets', () => {
		vi.mocked(useEnv).mockReturnValue({
			WEBSOCKETS_ENABLED: true,
			WEBSOCKETS_GRAPHQL_ENABLED: true,
			OUT_OF_SCOPE_FEATURES_ALLOWED: [],
		});

		validateOutOfScopeFeaturesEnv();

		expect(mockLogger.error).toHaveBeenCalledWith(
			'"WEBSOCKETS_GRAPHQL_ENABLED" Environment Variable is true, a feature'
				+ ' out of the tested scope (#756): add "websockets-graphql" to'
				+ ' OUT_OF_SCOPE_FEATURES_ALLOWED to run it untested.',
		);

		expect(process.exit).toHaveBeenCalledWith(1);
	});

	test('takes the GraphQL websocket flag on a server without websockets', () => {
		vi.mocked(useEnv).mockReturnValue({
			WEBSOCKETS_ENABLED: false,
			WEBSOCKETS_GRAPHQL_ENABLED: true,
			OUT_OF_SCOPE_FEATURES_ALLOWED: [],
		});

		validateOutOfScopeFeaturesEnv();

		expect(process.exit).not.toHaveBeenCalled();
	});

	test('logs each refusal before one exit', () => {
		vi.mocked(useEnv).mockReturnValue({
			EXTENSIONS_AUTO_RELOAD: true,
			OUT_OF_SCOPE_FEATURES_ALLOWED: ['ldapp'],
		});

		validateOutOfScopeFeaturesEnv();

		expect(vi.mocked(mockLogger.error).mock.calls).toEqual([
			[
				'"OUT_OF_SCOPE_FEATURES_ALLOWED" Environment Variable names "ldapp",'
					+ ' which is not one of ldap, oauth2, openid, saml,'
					+ ' websockets-graphql, extensions-auto-reload, shares,'
					+ ' comments.',
			],
			[
				'"EXTENSIONS_AUTO_RELOAD" Environment Variable is true, a feature'
					+ ' out of the tested scope (#627): add "extensions-auto-reload"'
					+ ' to OUT_OF_SCOPE_FEATURES_ALLOWED to run it untested.',
			],
		]);

		expect(process.exit).toHaveBeenCalledTimes(1);
		expect(process.exit).toHaveBeenCalledWith(1);
	});
});
