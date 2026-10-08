import { useEnv } from '@directus/env';
import type { Logger } from 'pino';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { useLogger } from '../logger/index.js';
import {
	validateBooleanEnv,
	validateBytesEnv,
	validateChoiceEnv,
	validateDurationEnv,
	validateEnv,
	validateHeaderNameEnv,
} from './validate-env.js';

vi.mock('@directus/env');

vi.mock('../logger');

let mockLogger: Logger<never>;

beforeAll(() => {
	vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

	vi.mocked(useEnv).mockReturnValue({
		PRESENT_TEST_VARIABLE: 'true',
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
	validateEnv(['PRESENT_TEST_VARIABLE']);

	expect(mockLogger.error).not.toHaveBeenCalled();
	expect(process.exit).not.toHaveBeenCalled();
});

test('should have error when key is missing', () => {
	validateEnv(['ABSENT_TEST_VARIABLE']);

	expect(mockLogger.error).toHaveBeenCalled();
	expect(process.exit).toHaveBeenCalled();
});

// `toBoolean` reads anything else as `false`, so a deployment that meant
// `TRUE` turns the feature off and gets no line saying it did.
test.each(['TRUE', 'oui', 'yes', 'on', 'true '])(
	'refuses %j, which is read as false',
	(value) => {
		process.env['BOOLEAN_TEST_VARIABLE'] = value;

		validateBooleanEnv(['BOOLEAN_TEST_VARIABLE']);

		expect(mockLogger.error).toHaveBeenCalledWith(
			`"BOOLEAN_TEST_VARIABLE" Environment Variable is ${JSON.stringify(value)}, `
				+ 'which is not a boolean. Use one of true, false, 1, 0.',
		);

		expect(process.exit).toHaveBeenCalledWith(1);
	},
);

// Both spellings of each, and the variable a deployment never set: a check that
// refused one of these would be an outage of its own.
test.each(['true', 'false', '1', '0'])('takes %j', (value) => {
	process.env['BOOLEAN_TEST_VARIABLE'] = value;

	validateBooleanEnv(['BOOLEAN_TEST_VARIABLE']);

	expect(mockLogger.error).not.toHaveBeenCalled();
	expect(process.exit).not.toHaveBeenCalled();
});

test('takes a variable the deployment never set', () => {
	delete process.env['BOOLEAN_TEST_VARIABLE'];

	validateBooleanEnv(['BOOLEAN_TEST_VARIABLE']);

	expect(mockLogger.error).not.toHaveBeenCalled();
	expect(process.exit).not.toHaveBeenCalled();
});

// Taking one would open no fill pause, and a new build would fill beside the
// build before.
test.each([
	{
		value: '-5m',
		message: '"DURATION_TEST_VARIABLE" Environment Variable is "-5m", '
			+ 'which is not a duration of 0 or more.',
	},
	{
		value: 'five minutes',
		message: '"DURATION_TEST_VARIABLE" Environment Variable is '
			+ '"five minutes", which is not a duration of 0 or more.',
	},
	{
		value: `1${'0'.repeat(400)}`,
		message: '"DURATION_TEST_VARIABLE" Environment Variable is '
			+ `"1${'0'.repeat(400)}", which is not a duration of 0 or more.`,
	},
])('refuses the duration $value', ({ value, message }) => {
	vi.mocked(useEnv).mockReturnValueOnce({ DURATION_TEST_VARIABLE: value });

	validateDurationEnv(['DURATION_TEST_VARIABLE']);

	expect(mockLogger.error).toHaveBeenCalledExactlyOnceWith(message);
	expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
});

test.each(['0', '5m', '4.1m'])('takes the duration %j', (value) => {
	vi.mocked(useEnv).mockReturnValueOnce({ DURATION_TEST_VARIABLE: value });

	validateDurationEnv(['DURATION_TEST_VARIABLE']);

	expect(mockLogger.error).not.toHaveBeenCalled();
	expect(process.exit).not.toHaveBeenCalled();
});

test.each([
	{
		value: '-1kb',
		message: '"BYTES_TEST_VARIABLE" Environment Variable is "-1kb", '
			+ 'which is not a size of 0 or more.',
	},
	{
		value: 'eight kilobytes',
		message: '"BYTES_TEST_VARIABLE" Environment Variable is '
			+ '"eight kilobytes", which is not a size of 0 or more.',
	},
	{
		value: '16k',
		message: '"BYTES_TEST_VARIABLE" Environment Variable is "16k", '
			+ 'which is not a size of 0 or more.',
	},
	{
		value: '8KiB',
		message: '"BYTES_TEST_VARIABLE" Environment Variable is "8KiB", '
			+ 'which is not a size of 0 or more.',
	},
	{
		value: '8,192',
		message: '"BYTES_TEST_VARIABLE" Environment Variable is "8,192", '
			+ 'which is not a size of 0 or more.',
	},
	{
		value: '12abc',
		message: '"BYTES_TEST_VARIABLE" Environment Variable is "12abc", '
			+ 'which is not a size of 0 or more.',
	},
	{
		value: '1e3',
		message: '"BYTES_TEST_VARIABLE" Environment Variable is "1e3", '
			+ 'which is not a size of 0 or more.',
	},
])('refuses the size $value', ({ value, message }) => {
	vi.mocked(useEnv).mockReturnValueOnce({ BYTES_TEST_VARIABLE: value });

	validateBytesEnv(['BYTES_TEST_VARIABLE']);

	expect(mockLogger.error).toHaveBeenCalledExactlyOnceWith(message);
	expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
});

test.each(['0', '8kb', '512', '1.5mb', '8 KB'])('takes the size %j', (value) => {
	vi.mocked(useEnv).mockReturnValueOnce({ BYTES_TEST_VARIABLE: value });

	validateBytesEnv(['BYTES_TEST_VARIABLE']);

	expect(mockLogger.error).not.toHaveBeenCalled();
	expect(process.exit).not.toHaveBeenCalled();
});

test('refuses a size below the minimum other than 0', () => {
	vi.mocked(useEnv).mockReturnValueOnce({ BYTES_TEST_VARIABLE: '255' });

	validateBytesEnv(['BYTES_TEST_VARIABLE'], 256);

	expect(mockLogger.error).toHaveBeenCalledExactlyOnceWith(
		'"BYTES_TEST_VARIABLE" Environment Variable is "255", '
			+ 'which is neither 0 nor a size of 256 bytes or more.',
	);

	expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
});

test.each(['0', '256', '1kb'])('takes the size %j past the minimum', (value) => {
	vi.mocked(useEnv).mockReturnValueOnce({ BYTES_TEST_VARIABLE: value });

	validateBytesEnv(['BYTES_TEST_VARIABLE'], 256);

	expect(mockLogger.error).not.toHaveBeenCalled();
	expect(process.exit).not.toHaveBeenCalled();
});

test('refuses a choice outside the list', () => {
	vi.mocked(useEnv).mockReturnValueOnce({ CHOICE_TEST_VARIABLE: 'every' });

	validateChoiceEnv('CHOICE_TEST_VARIABLE', ['counts', 'full']);

	expect(mockLogger.error).toHaveBeenCalledExactlyOnceWith(
		'"CHOICE_TEST_VARIABLE" Environment Variable is "every", '
			+ 'which is not one of counts, full.',
	);

	expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
});

test('takes a choice from the list', () => {
	vi.mocked(useEnv).mockReturnValueOnce({ CHOICE_TEST_VARIABLE: 'full' });

	validateChoiceEnv('CHOICE_TEST_VARIABLE', ['counts', 'full']);

	expect(mockLogger.error).not.toHaveBeenCalled();
	expect(process.exit).not.toHaveBeenCalled();
});

// Node throws on every `setHeader` of such a name: every response would fail.
test('refuses a header name Node cannot write', () => {
	vi.mocked(useEnv).mockReturnValueOnce({ HEADER_TEST_VARIABLE: 'x query audit' });

	validateHeaderNameEnv('HEADER_TEST_VARIABLE');

	expect(mockLogger.error).toHaveBeenCalledExactlyOnceWith(
		'"HEADER_TEST_VARIABLE" Environment Variable is "x query audit", '
			+ 'which is not a valid header name.',
	);

	expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
});

// A boolean would turn the audit on under a header of that name.
test.each(['false', 'true', 'FALSE', '0', '1'])(
	'refuses a header name that reads as the boolean %j',
	(value) => {
		vi.mocked(useEnv).mockReturnValueOnce({ HEADER_TEST_VARIABLE: value });

		validateHeaderNameEnv('HEADER_TEST_VARIABLE');

		expect(mockLogger.error).toHaveBeenCalledExactlyOnceWith(
			`"HEADER_TEST_VARIABLE" Environment Variable is "${value}", `
				+ 'which reads as a boolean, not a header name: leave it unset '
				+ 'to send none.',
		);

		expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
	},
);

test('takes a header name Node can write', () => {
	vi.mocked(useEnv).mockReturnValueOnce({ HEADER_TEST_VARIABLE: 'X-Query-Audit' });

	validateHeaderNameEnv('HEADER_TEST_VARIABLE');

	expect(mockLogger.error).not.toHaveBeenCalled();
	expect(process.exit).not.toHaveBeenCalled();
});
