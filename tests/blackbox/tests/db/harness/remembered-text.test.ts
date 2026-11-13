import { rememberedText } from '@common/cucumber';
import { describe, expect, test } from 'vitest';

describe('rememberedText', () => {
	test('fails a row remembering a value the response does not hold', () => {
		expect(() => rememberedText('team', undefined)).toThrow(
			new Error('"team" remembers nothing: the response holds no value'),
		);
	});

	test('fails a row remembering a null the response holds', () => {
		expect(() => rememberedText('team', null)).toThrow(
			new Error('"team" remembers nothing: the response holds no value'),
		);
	});

	test('keeps a falsy key as its text', () => {
		expect(rememberedText('team', 0)).toBe('0');
	});

	test('keeps a uuid key as is', () => {
		expect(rememberedText('team', '7f3c2a10-5b1e-4c9d-8a2f-1e6b0d4c9a77')).toBe(
			'7f3c2a10-5b1e-4c9d-8a2f-1e6b0d4c9a77',
		);
	});
});
