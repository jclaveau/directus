import { toArray, toBoolean } from '@directus/utils/values';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { guessType } from '../utils/guess-type.js';
import { getCastFlag } from '../utils/has-cast-prefix.js';
import { toNumber, toString } from '../utils/lodash-es-used.js';
import { tryJson } from '../utils/try-json.js';
import { castEnvVarValue } from './cast.js';

vi.mock('@directus/utils/values');
vi.mock('lodash-es/toNumber.js');
vi.mock('lodash-es/toString.js');
vi.mock('../utils/guess-type.js');
vi.mock('../utils/has-cast-prefix.js');
vi.mock('../utils/try-json.js');

afterEach(() => {
	vi.clearAllMocks();
});

describe('Type extraction', () => {
	test('Uses cast flag if exists', () => {
		vi.mocked(getCastFlag).mockReturnValue('string');

		castEnvVarValue('string:value', null);

		expect(getCastFlag).toHaveBeenCalledWith('string:value');
		expect(toString).toHaveBeenCalledWith('value');
	});

	test('keeps the items of an array as strings, cast flags included', () => {
		vi.mocked(getCastFlag).mockImplementation((val) => {
			if (String(val).startsWith('array')) return 'array';
			if (String(val).startsWith('string')) return 'string';
			return 'number';
		});

		vi.mocked(toArray).mockReturnValue(['string:hey', 'number:1']);

		const res = castEnvVarValue('array:string:hey,number:1', null);

		expect(vi.mocked(getCastFlag).mock.calls).toEqual([
			['array:string:hey,number:1'],
			['array:string:hey,number:1'],
		]);

		expect(toArray).toHaveBeenCalledWith('string:hey,number:1');
		expect(res).toEqual(['string:hey', 'number:1']);
	});

	test('Uses type map entry if cast flag does not exist', () => {
		vi.mocked(getCastFlag).mockReturnValue(null);
		castEnvVarValue('value', 'string');

		expect(toString).toHaveBeenCalledWith('value');
	});

	test('Uses guessed type if no flag or type map entry exist', () => {
		vi.mocked(getCastFlag).mockReturnValue(null);
		vi.mocked(guessType).mockReturnValue('string');

		castEnvVarValue('value', null);

		expect(guessType).toHaveBeenCalledWith('value');
		expect(toString).toHaveBeenCalledWith('value');
	});
});

describe('Casting', () => {
	test('Uses toString for string types', () => {
		vi.mocked(getCastFlag).mockReturnValue('string');

		vi.mocked(toString).mockReturnValue('cast-value');
		expect(castEnvVarValue('value', null)).toBe('cast-value');
	});

	test('Uses toNumber for number types', () => {
		vi.mocked(getCastFlag).mockReturnValue('number');

		vi.mocked(toNumber).mockReturnValue(123);
		expect(castEnvVarValue('value', null)).toBe(123);
	});

	test('Uses toBoolean for boolean types', () => {
		vi.mocked(getCastFlag).mockReturnValue('boolean');

		vi.mocked(toBoolean).mockReturnValue(false);
		expect(castEnvVarValue('value', null)).toBe(false);
	});

	test('Uses RegExp for regex types', () => {
		vi.mocked(getCastFlag).mockReturnValue('regex');
		expect(castEnvVarValue('value', null)).toBeInstanceOf(RegExp);
	});

	test('Uses toArray for array types', () => {
		vi.mocked(getCastFlag).mockImplementation((v) => {
			if (String(v).startsWith('array')) return 'array';
			return null;
		});

		vi.mocked(toArray).mockReturnValue([1, 2, 3]);

		expect(castEnvVarValue('array:value', null)).toEqual(['1', '2', '3']);
	});

	test('Filters empty strings values out of the array', () => {
		vi.mocked(getCastFlag).mockImplementation((v) => {
			if (String(v).startsWith('array')) return 'array';
			return null;
		});

		vi.mocked(toArray).mockReturnValue(['', '']);

		expect(castEnvVarValue('array:,', null)).toEqual([]);
	});

	test('Uses tryJson for json types', () => {
		vi.mocked(getCastFlag).mockReturnValue('json');

		vi.mocked(tryJson).mockReturnValue('cast-value');
		expect(castEnvVarValue('value', null)).toBe('cast-value');
	});
});
