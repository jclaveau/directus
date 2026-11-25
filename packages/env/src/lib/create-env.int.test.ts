import { afterEach, expect, test, vi } from 'vitest';
import { readConfigurationFromProcess } from '../utils/read-configuration-from-process.js';
import { createEnv, readEnvRawValues } from './create-env.js';
import { readConfigurationFromFile } from './read-configuration-from-file.js';
import { isDirectusVariable } from '../utils/is-directus-variable.js';
import { readFileSync } from 'node:fs';

vi.mock('../utils/get-config-path.js');
vi.mock('../utils/read-configuration-from-process.js');
vi.mock('./read-configuration-from-file.js');
vi.mock('../utils/is-directus-variable.js');
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
	vi.mocked(isDirectusVariable).mockReturnValue(true);
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
		PROCESS4: ['string:hey', 'number:1'],
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
	vi.mocked(isDirectusVariable).mockReturnValue(true);

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
	vi.mocked(isDirectusVariable).mockReturnValue(true);

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
	vi.mocked(isDirectusVariable).mockReturnValue(true);

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

	vi.mocked(isDirectusVariable).mockReturnValue(true);

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
	vi.mocked(isDirectusVariable).mockReturnValue(true);
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
	vi.mocked(isDirectusVariable).mockReturnValue(true);

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
	vi.mocked(isDirectusVariable).mockReturnValue(true);

	expect(createEnv()).toEqual({
		UNMAPPED_FLAG: true,
		DEFAULT: 'test-default',
		DEFAULT_ARRAY: 'one,two,three',
	});
});

// Docker and Kubernetes write a secret with a trailing newline.
test('Trims a secret file holding a boolean', () => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({
		CACHE_ENABLED_FILE: './file.txt',
	});

	vi.mocked(readConfigurationFromFile).mockReturnValue({});
	vi.mocked(isDirectusVariable).mockReturnValue(true);
	vi.mocked(readFileSync).mockReturnValueOnce('true\n');

	expect(createEnv()).toEqual({
		CACHE_ENABLED: true,
		DEFAULT: 'test-default',
		DEFAULT_ARRAY: 'one,two,three',
	});
});

// A password is its bytes, trailing newline included.
test('Keeps a secret file holding a string as it is', () => {
	vi.mocked(readConfigurationFromProcess).mockReturnValue({
		DB_PASSWORD_FILE: './file.txt',
	});

	vi.mocked(readConfigurationFromFile).mockReturnValue({});
	vi.mocked(isDirectusVariable).mockReturnValue(true);
	vi.mocked(readFileSync).mockReturnValueOnce(' p4ss\n');

	expect(createEnv()).toEqual({
		DB_PASSWORD: ' p4ss\n',
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

	vi.mocked(isDirectusVariable).mockReturnValue(true);

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
			+ '"CACHE_ENABLED" is "yes", which is not a boolean:'
			+ ' use true, false, 1 or 0.',
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

	expect(readEnvRawValues()).toEqual({
		DB_PORT: '5432',
		UNDECLARED_NAME: '0123',
	});
});
