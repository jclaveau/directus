import { afterEach, expect, test, vi } from 'vitest';
import { readConfigurationFromProcess } from '../utils/read-configuration-from-process.js';
import { createEnv, readEnvVarRawValues } from './create-env.js';
import { readConfigurationFromFile } from './read-configuration-from-file.js';
import { isCoreEnvVarName } from '../utils/is-core-env-var-name.js';
import { readFileSync } from 'node:fs';

vi.mock('../utils/get-config-path.js');
vi.mock('../utils/read-configuration-from-process.js');
vi.mock('./read-configuration-from-file.js');
vi.mock('../utils/is-core-env-var-name.js');
vi.mock('node:fs');

vi.mock('../constants/defaults.js', () => ({
	DEFAULTS: {
		DEFAULT: 'test-default',
		DEFAULT_ARRAY: 'one,two,three',
	},
}));

afterEach(() => {
	vi.resetAllMocks();
});

test('Defaults that have a type set is casted', () => {
	const processConfigs = {
		PROCESS1: 'test-process',
		PROCESS2: 'array:one,two',
		PROCESS3: 'one,two,three',
		PROCESS4: 'array:string:hey,number:1',
		PROCESS5_FILE: './file.txt',
		PROCESS6_FILE: 'array:./file.txt',
		PROCESS7: 'string:ran,d0m',
		PROCESS8_FILE: 'string:./file.txt',
	};

	const fileConfigs = {
		FILE1: 'test-file',
		FILE2_FILE: './file.txt',
		FILE3_FILE: 'array:./file.txt',
	};

	vi.mocked(readConfigurationFromProcess).mockReturnValue(processConfigs);
	vi.mocked(readConfigurationFromFile).mockReturnValue(fileConfigs);
	vi.mocked(isCoreEnvVarName).mockReturnValue(true);
	vi.mocked(readFileSync).mockReturnValueOnce('file-content');
	vi.mocked(readFileSync).mockReturnValueOnce('one,two,three');
	vi.mocked(readFileSync).mockReturnValueOnce('ran,d0m,from-file');
	vi.mocked(readFileSync).mockReturnValueOnce('file-from-file-content');
	vi.mocked(readFileSync).mockReturnValueOnce('elem1,elem2');

	const env = createEnv();

	expect(env).toEqual({
		PROCESS1: 'test-process',
		PROCESS2: ['one', 'two'],
		PROCESS3: ['one', 'two', 'three'],
		PROCESS4: ['hey', 1],
		PROCESS5: 'file-content',
		PROCESS6: ['one', 'two', 'three'],
		PROCESS7: 'ran,d0m',
		PROCESS8: 'ran,d0m,from-file',
		FILE1: 'test-file',
		FILE2: 'file-from-file-content',
		FILE3: ['elem1', 'elem2'],
		DEFAULT: 'test-default',
		DEFAULT_ARRAY: 'one,two,three',
	});
});

test('Named-connection USER/PASSWORD stay string, not guessType', () => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({
		// secrets must stay strings — guessType would coerce "12345" → 12345 and
		// "true" → boolean, breaking auth; PORT is the number control.
		DB_CONNECTION_PREMIUM_PASSWORD: '12345',
		DB_CONNECTION_PREMIUM_USER: 'true',
		DB_CONNECTION_PREMIUM_PORT: '5432',
	});

	vi.mocked(readConfigurationFromFile).mockReturnValue({});
	vi.mocked(isCoreEnvVarName).mockReturnValue(true);

	expect(createEnv()).toEqual({
		DB_CONNECTION_PREMIUM_PASSWORD: '12345',
		DB_CONNECTION_PREMIUM_USER: 'true',
		DB_CONNECTION_PREMIUM_PORT: 5432,
		DEFAULT: 'test-default',
		DEFAULT_ARRAY: 'one,two,three',
	});
});

// `toBoolean` reads anything but these four spellings as false, so a deployment
// that meant `yes` would turn the feature off and get no line saying it did.
test('Refuses a boolean variable from the process that is not one', () => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({
		CACHE_ENABLED: 'yes',
	});

	vi.mocked(readConfigurationFromFile).mockReturnValue({});
	vi.mocked(isCoreEnvVarName).mockReturnValue(true);

	expect(() => createEnv()).toThrow(
		new Error(
			'"CACHE_ENABLED" Environment Variable is "yes", which is not a boolean. '
				+ 'Use one of true, false, 1, 0.',
		),
	);
});

test.each([
	{ value: 'TRUE', expected: true },
	{ value: ' True ', expected: true },
	{ value: 'true\n', expected: true },
	{ value: 'FALSE', expected: false },
	{ value: ' 0 ', expected: false },
])('Reads $value from the process as a boolean', ({ value, expected }) => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({
		CACHE_ENABLED: value,
	});

	vi.mocked(readConfigurationFromFile).mockReturnValue({});
	vi.mocked(isCoreEnvVarName).mockReturnValue(true);

	expect(createEnv()).toEqual({
		CACHE_ENABLED: expected,
		DEFAULT: 'test-default',
		DEFAULT_ARRAY: 'one,two,three',
	});
});

test('Refuses a boolean variable from the config file that is not one', () => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({});

	vi.mocked(readConfigurationFromFile).mockReturnValue({
		CACHE_ENABLED: 'yes',
	});

	vi.mocked(isCoreEnvVarName).mockReturnValue(true);

	expect(() => createEnv()).toThrow(
		new Error(
			'"CACHE_ENABLED" Environment Variable is "yes", which is not a boolean. '
				+ 'Use one of true, false, 1, 0.',
		),
	);
});

test('Refuses a boolean variable from a secret file that is not one', () => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({
		CACHE_ENABLED_FILE: './file.txt',
	});

	vi.mocked(readConfigurationFromFile).mockReturnValue({});
	vi.mocked(isCoreEnvVarName).mockReturnValue(true);
	vi.mocked(readFileSync).mockReturnValueOnce('on\n');

	expect(() => createEnv()).toThrow(
		new Error(
			'"CACHE_ENABLED" Environment Variable is "on", which is not a boolean. '
				+ 'Use one of true, false, 1, 0.',
		),
	);
});

test('Refuses a value cast to boolean that is not one', () => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({
		UNMAPPED_FLAG: 'boolean:yes',
	});

	vi.mocked(readConfigurationFromFile).mockReturnValue({});
	vi.mocked(isCoreEnvVarName).mockReturnValue(true);

	expect(() => createEnv()).toThrow(
		new Error(
			'"UNMAPPED_FLAG" Environment Variable is "yes", which is not a boolean. '
				+ 'Use one of true, false, 1, 0.',
		),
	);
});

test('Reads a value cast to boolean in capitals as a boolean', () => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({
		UNMAPPED_FLAG: 'boolean:TRUE',
	});

	vi.mocked(readConfigurationFromFile).mockReturnValue({});
	vi.mocked(isCoreEnvVarName).mockReturnValue(true);

	expect(createEnv()).toEqual({
		UNMAPPED_FLAG: true,
		DEFAULT: 'test-default',
		DEFAULT_ARRAY: 'one,two,three',
	});
});

test('Reads FALSE as false on the boolean auth and storage globs', () => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({
		AUTH_CORP_ALLOW_PUBLIC_REGISTRATION: 'FALSE',
		AUTH_CORP_SYNC_USER_INFO: 'FALSE',
		STORAGE_S3_FORCE_PATH_STYLE: 'FALSE',
	});

	vi.mocked(readConfigurationFromFile).mockReturnValue({});
	vi.mocked(isCoreEnvVarName).mockReturnValue(true);

	expect(createEnv()).toEqual({
		AUTH_CORP_ALLOW_PUBLIC_REGISTRATION: false,
		AUTH_CORP_SYNC_USER_INFO: false,
		STORAGE_S3_FORCE_PATH_STYLE: false,
		DEFAULT: 'test-default',
		DEFAULT_ARRAY: 'one,two,three',
	});
});

test('Refuses a boolean storage glob that is not one', () => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({
		STORAGE_S3_FORCE_PATH_STYLE: 'yes',
	});

	vi.mocked(readConfigurationFromFile).mockReturnValue({});
	vi.mocked(isCoreEnvVarName).mockReturnValue(true);

	expect(() => createEnv()).toThrow(
		new Error(
			'"STORAGE_S3_FORCE_PATH_STYLE" Environment Variable is "yes", '
				+ 'which is not a boolean. Use one of true, false, 1, 0.',
		),
	);
});

// Docker and Kubernetes write a secret with a trailing newline.
test('Trims a secret file holding a boolean', () => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({
		CACHE_ENABLED_FILE: './file.txt',
	});

	vi.mocked(readConfigurationFromFile).mockReturnValue({});
	vi.mocked(isCoreEnvVarName).mockReturnValue(true);
	vi.mocked(readFileSync).mockReturnValueOnce('true\n');

	expect(createEnv()).toEqual({
		CACHE_ENABLED: true,
		DEFAULT: 'test-default',
		DEFAULT_ARRAY: 'one,two,three',
	});
});

// echo and Kubernetes end a secret with newlines; a password keeps its spaces.
test.each([
	[' p4ss\n', ' p4ss'],
	[' p4ss\n\n', ' p4ss'],
	['p4ss \n', 'p4ss '],
	['p4ss\r\n', 'p4ss'],
	['p4ss\r\n\r\n', 'p4ss'],
	['p4ss\r', 'p4ss\r'],
])('Strips only the trailing newlines of a string secret file %j', (
	fileContent,
	envVarValue,
) => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({
		DB_PASSWORD_FILE: './file.txt',
	});

	vi.mocked(readConfigurationFromFile).mockReturnValue({});
	vi.mocked(isCoreEnvVarName).mockReturnValue(true);
	vi.mocked(readFileSync).mockReturnValueOnce(fileContent);

	expect(createEnv()).toEqual({
		DB_PASSWORD: envVarValue,
		DEFAULT: 'test-default',
		DEFAULT_ARRAY: 'one,two,three',
	});
});

test.each([
	{ value: 'true', expected: true },
	{ value: 'false', expected: false },
	{ value: '1', expected: true },
	{ value: '0', expected: false },
	{ value: true, expected: true },
	{ value: false, expected: false },
])('Takes $value for a boolean variable', ({ value, expected }) => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({});

	vi.mocked(readConfigurationFromFile).mockReturnValue({
		CACHE_ENABLED: value,
	});

	vi.mocked(isCoreEnvVarName).mockReturnValue(true);

	expect(createEnv()).toEqual({
		CACHE_ENABLED: expected,
		DEFAULT: 'test-default',
		DEFAULT_ARRAY: 'one,two,three',
	});
});

test('refuses every declared variable its value does not fit, at once', () => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({
		DB_PORT: 'abc',
		CACHE_STORE: 'memcache',
		CACHE_ENABLED: 'yes',
		UNDECLARED_NAME: 'abc',
	});

	vi.mocked(readConfigurationFromFile).mockReturnValue({});

	expect(() => createEnv()).toThrow(new Error(
		'"DB_PORT" is "abc", which is not a number.\n'
			+ '"CACHE_STORE" is "memcache", which is not one of "memory", "redis".\n'
			+ '"CACHE_ENABLED" Environment Variable is "yes", which is not a'
			+ ' boolean. Use one of true, false, 1, 0.',
	));
});

// Refused after the extensions load, unless one declares it.
test('keeps a name under a core prefix that core does not declare', () => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({
		DB_VACUUM_CRON_FREQUENCY: '0 6 * * *',
	});

	vi.mocked(readConfigurationFromFile).mockReturnValue({});

	expect(createEnv()).toEqual({
		DB_VACUUM_CRON_FREQUENCY: '0 6 * * *',
		DEFAULT: 'test-default',
		DEFAULT_ARRAY: 'one,two,three',
	});
});

test('lists a boolean refusal beside the others', () => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({
		DB_PORT: 'abc',
		CACHE_ENABLED: 'TRUE',
		HSTS_PRELOAD: 'yes',
	});

	vi.mocked(readConfigurationFromFile).mockReturnValue({});

	expect(() => createEnv()).toThrow(new Error(
		'"DB_PORT" is "abc", which is not a number.\n'
			+ '"HSTS_PRELOAD" Environment Variable is "yes", which is not a'
			+ ' boolean. Use one of true, false, 1, 0.',
	));
});

test('keeps each value as it was set beside the cast one', () => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({
		DB_PORT: '5432',
		UNDECLARED_NAME: '0123',
	});

	vi.mocked(readConfigurationFromFile).mockReturnValue({});

	expect(createEnv()).toEqual({
		DB_PORT: 5432,
		UNDECLARED_NAME: '0123',
		DEFAULT: 'test-default',
		DEFAULT_ARRAY: 'one,two,three',
	});

	expect(readEnvVarRawValues()).toEqual({
		DB_PORT: '5432',
		UNDECLARED_NAME: '0123',
	});
});

test.each([
	[
		'UNMAPPED_COUNT',
		'number:abc',
		'"UNMAPPED_COUNT" is "number:abc", which is not a number.',
	],
	[
		'UNMAPPED_COUNT',
		'number:',
		'"UNMAPPED_COUNT" is "number:", which is not a number.',
	],
	['SUBS_API_KEY', 'number:abc', '"SUBS_API_KEY" is not a number.'],
	[
		'UNMAPPED_PATTERN',
		'regex:(',
		'"UNMAPPED_PATTERN" is "(", which is not a regex.',
	],
	['UNMAPPED_JSON', 'json:{bad', '"UNMAPPED_JSON" is not JSON.'],
])('Refuses %s=%s, a prefix its value does not fit', (
	envVarName,
	envVarValue,
	refusalMessage,
) => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({
		[envVarName]: envVarValue,
	});

	vi.mocked(readConfigurationFromFile).mockReturnValue({});
	vi.mocked(isCoreEnvVarName).mockReturnValue(true);

	expect(() => createEnv()).toThrow(new Error(refusalMessage));
});

test('Refuses a number: prefix from a secret file that is not a number', () => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({
		UNMAPPED_COUNT_FILE: 'number:./file.txt',
	});

	vi.mocked(readConfigurationFromFile).mockReturnValue({});
	vi.mocked(isCoreEnvVarName).mockReturnValue(true);
	vi.mocked(readFileSync).mockReturnValueOnce('abc\n');

	expect(() => createEnv()).toThrow(
		new Error('"UNMAPPED_COUNT" is "number:abc", which is not a number.'),
	);
});

test('Refuses an item of an array: value its own prefix does not fit', () => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({
		UNMAPPED_LIST: 'array:1,number:abc',
	});

	vi.mocked(readConfigurationFromFile).mockReturnValue({});
	vi.mocked(isCoreEnvVarName).mockReturnValue(true);

	expect(() => createEnv()).toThrow(
		new Error('"UNMAPPED_LIST" is "number:abc", which is not a number.'),
	);
});

test('Refuses a variable set both directly and through its _FILE variable', () => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({
		DB_PASSWORD: 'from-env',
		DB_PASSWORD_FILE: './file.txt',
	});

	vi.mocked(readConfigurationFromFile).mockReturnValue({});
	vi.mocked(isCoreEnvVarName).mockReturnValue(true);

	expect(() => createEnv()).toThrow(new Error(
		'"DB_PASSWORD" and "DB_PASSWORD_FILE" are both set. Set only one.',
	));
});

// A typed variable is cast by its declaration, never by what its value looks like.
test.each([
	['HASH_ASSOCIATED_DATA', '123', '123'],
	['DB_SSL', 'true', true],
	['DB_SSL__REJECT_UNAUTHORIZED', 'false', false],
	['DB_SSL__CA', '123456', '123456'],
	['DB_CONNECTION_REPLICA_SSL__TIMEOUT', '30', 30],
	['AUTH_X_SP_WANT_MESSAGE_SIGNED', 'true', true],
	['AUTH_X_IDP_METADATA', '1', '1'],
	['AUTH_X_CLIENT_HTTP_TIMEOUT', '5000', 5000],
	['AUTH_X_DEFAULT_ROLE_ID', '42', '42'],
	['AUTH_X_REDIRECT_ALLOW_LIST', 'https://a.example', ['https://a.example']],
	['CONTENT_SECURITY_POLICY_DIRECTIVES__IMG_SRC', "'self'", ["'self'"]],
	['WEBSOCKETS_REST_AUTH_TIMEOUT', '10', 10],
	['STORAGE_LOCAL_KEY', '0123', '0123'],
	['CONTENT_SECURITY_POLICY_DIRECTIVES__SCRIPT_SRC', 'null', null],
	['ASSETS_CONTENT_SECURITY_POLICY_DIRECTIVES__SCRIPT_SRC', 'null', null],
	['AUTH_X_LOGIN_TIMEOUT', '300', 300],
	['AUTH_X_LOGIN_TIMEOUT', '5m', '5m'],
	['AUTH_X_LOGIN_TIMEOUT', ' 300 ', 300],
	['AUTH_X_LOGIN_TIMEOUT', -5, -5],
	['DB_CONNECTION_REPLICA_SSL__SECURE_OPTIONS', '524288', 524288],
	['AUTH_X_REQUIRE_VERIFIED_EMAIL', 'true', true],
	['AUTH_X_PLAIN_CODE_CHALLENGE', 'false', false],
	['AUTH_X_GROUP_CLAIM_NAME', '123', '123'],
	['AUTH_X_ROLE_MAPPING', '{"staff":"5b3e8f0a"}', { staff: '5b3e8f0a' }],
	['AUTH_X_GIVEN_NAME_KEY', '1', '1'],
	['AUTH_X_FAMILY_NAME_KEY', '1', '1'],
])('Casts %s=%j by its declaration', (envVarName, rawValue, envVarValue) => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({
		[envVarName]: rawValue,
	});

	vi.mocked(readConfigurationFromFile).mockReturnValue({});

	expect(createEnv()).toEqual({
		[envVarName]: envVarValue,
		DEFAULT: 'test-default',
		DEFAULT_ARRAY: 'one,two,three',
	});
});

// An untyped secret loses its trailing newlines before its value is guessed.
test.each([
	['true\n', true],
	['TLSv1.2\n', 'TLSv1.2'],
])('Guesses an untyped secret file %j without its newlines', (
	fileContent,
	envVarValue,
) => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({
		UNMAPPED_SETTING_FILE: './file.txt',
	});

	vi.mocked(readConfigurationFromFile).mockReturnValue({});
	vi.mocked(isCoreEnvVarName).mockReturnValue(true);
	vi.mocked(readFileSync).mockReturnValueOnce(fileContent);

	expect(createEnv()).toEqual({
		UNMAPPED_SETTING: envVarValue,
		DEFAULT: 'test-default',
		DEFAULT_ARRAY: 'one,two,three',
	});
});

test.each([
	[
		'AUTH_X_REQUIRE_VERIFIED_EMAIL',
		'yes',
		'"AUTH_X_REQUIRE_VERIFIED_EMAIL" Environment Variable is "yes",'
			+ ' which is not a boolean. Use one of true, false, 1, 0.',
	],
	[
		'AUTH_X_PLAIN_CODE_CHALLENGE',
		'yes',
		'"AUTH_X_PLAIN_CODE_CHALLENGE" Environment Variable is "yes",'
			+ ' which is not a boolean. Use one of true, false, 1, 0.',
	],
	[
		'AUTH_X_LOGIN_TIMEOUT',
		'true',
		'"AUTH_X_LOGIN_TIMEOUT" is "true",'
			+ ' which is neither a number of seconds nor a duration.',
	],
])('Refuses %s=%j', (envVarName, rawValue, refusalMessage) => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({
		[envVarName]: rawValue,
	});

	vi.mocked(readConfigurationFromFile).mockReturnValue({});

	expect(() => createEnv()).toThrow(new Error(refusalMessage));
});
