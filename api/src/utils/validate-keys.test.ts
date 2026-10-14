import { InvalidPayloadError } from '@directus/errors';
import { oneLine } from '@directus/utils';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateKeys } from './validate-keys.js';
import { SchemaBuilder } from '@directus/schema-builder';

const schema = new SchemaBuilder()
	.collection('pk_integer', (c) => {
		c.field('id').integer().primary();
	})
	.collection('pk_big_integer', (c) => {
		c.field('id')
			.bigInteger()
			.primary();
	})
	.collection('pk_uuid', (c) => {
		c.field('id').uuid().primary();
	})
	.build();

describe('validate keys', () => {
	describe('of integer type', () => {
		it('Throws an error when provided with an invalid integer key', () => {
			expect(() => validateKeys(schema, 'pk_integer', 'id', 'invalid')).toThrowError(InvalidPayloadError);
			expect(() => validateKeys(schema, 'pk_integer', 'id', NaN)).toThrowError(InvalidPayloadError);
		});

		it('Throws an error with a reason naming the expected integer type', () => {
			expect(() => validateKeys(schema, 'pk_integer', 'id', 'invalid')).toThrowError(
				'Primary key of pk_integer must be an integer instead of "invalid"',
			);
		});

		it('Throws an error when provided with an array containing an invalid integer key', () => {
			expect(() => validateKeys(schema, 'pk_integer', 'id', [111, 'invalid', 222])).toThrowError(InvalidPayloadError);
			expect(() => validateKeys(schema, 'pk_integer', 'id', [555, NaN, 666])).toThrowError(InvalidPayloadError);
		});

		it('Does not throw an error when provided with a valid integer key', () => {
			expect(() => validateKeys(schema, 'pk_integer', 'id', 111)).not.toThrowError();
			expect(() => validateKeys(schema, 'pk_integer', 'id', '222')).not.toThrowError();
		});

		it('Does not throw an error when provided with an array of valid integer keys', () => {
			expect(() => validateKeys(schema, 'pk_integer', 'id', [111, 222, 333])).not.toThrowError();
			expect(() => validateKeys(schema, 'pk_integer', 'id', ['444', '555', '666'])).not.toThrowError();
		});
	});

	describe('of integer type spelled as a string', () => {
		it.each([
			[
				'',
				'Primary key of pk_integer must be an integer instead of ""',
			],
			[
				' ',
				'Primary key of pk_integer must be an integer instead of " "',
			],
			[
				' 5',
				'Primary key of pk_integer must be an integer instead of " 5"',
			],
			[
				'0x10',
				'Primary key of pk_integer must be an integer instead of "0x10"',
			],
			[
				'1e2',
				'Primary key of pk_integer must be an integer instead of "1e2"',
			],
			[
				'0b1',
				'Primary key of pk_integer must be an integer instead of "0b1"',
			],
			[
				'1.0',
				'Primary key of pk_integer must be an integer instead of "1.0"',
			],
			[
				'+',
				'Primary key of pk_integer must be an integer instead of "+"',
			],
		])(
			'refuses the spelling %j',
			(spelledKey, reason) => {
				expect(() => validateKeys(schema, 'pk_integer', 'id', spelledKey))
					.toThrowError(new InvalidPayloadError({ reason }));
			},
		);

		it('accepts a signed decimal spelling', () => {
			expect(() => validateKeys(schema, 'pk_integer', 'id', ['-3', '+4', '07']))
				.not.toThrowError();
		});
	});

	describe('of bigInteger type', () => {
		it.each([
			[
				'invalid',
				oneLine`
					Primary key of pk_big_integer must be an integer instead of
					"invalid"
				`,
			],
			[
				'',
				oneLine`
					Primary key of pk_big_integer must be an integer instead of
					""
				`,
			],
			[
				'0x10',
				oneLine`
					Primary key of pk_big_integer must be an integer instead of
					"0x10"
				`,
			],
			[
				'1e2',
				oneLine`
					Primary key of pk_big_integer must be an integer instead of
					"1e2"
				`,
			],
			[
				1.5,
				oneLine`
					Primary key of pk_big_integer must be an integer instead of
					1.5
				`,
			],
			[
				Number.NaN,
				oneLine`
					Primary key of pk_big_integer must be an integer instead of
					null
				`,
			],
		])(
			'refuses the key %j',
			(invalidKey, reason) => {
				expect(() => validateKeys(schema, 'pk_big_integer', 'id', invalidKey))
					.toThrowError(new InvalidPayloadError({ reason }));
			},
		);

		it('accepts a key past the safe integer range spelled in decimal', () => {
			expect(() => {
				validateKeys(schema, 'pk_big_integer', 'id', ['9007199254740993', 12]);
			}).not.toThrowError();
		});
	});

	describe('of uuid type', () => {
		it('Throws an error when provided with an invalid uuid key', () => {
			expect(() => validateKeys(schema, 'pk_uuid', 'id', 'fakeuuid-62d9-434d-a7c7-878c8376782e')).toThrowError(
				InvalidPayloadError,
			);

			expect(() => validateKeys(schema, 'pk_uuid', 'id', 'invalid')).toThrowError(InvalidPayloadError);
			expect(() => validateKeys(schema, 'pk_uuid', 'id', NaN)).toThrowError(InvalidPayloadError);
			expect(() => validateKeys(schema, 'pk_uuid', 'id', 111)).toThrowError(InvalidPayloadError);
		});

		it('Throws an error with a reason naming the expected uuid type', () => {
			expect(() => validateKeys(schema, 'pk_uuid', 'id', 'invalid')).toThrowError(
				'Primary key of pk_uuid must be a uuid instead of "invalid"',
			);
		});

		it('Throws an error when provided with an array containing an invalid uuid key', () => {
			expect(() =>
				validateKeys(schema, 'pk_uuid', 'id', [randomUUID(), 'fakeuuid-62d9-434d-a7c7-878c8376782e', randomUUID()]),
			).toThrowError(InvalidPayloadError);

			expect(() => validateKeys(schema, 'pk_uuid', 'id', [randomUUID(), 'invalid', randomUUID()])).toThrowError(
				InvalidPayloadError,
			);

			expect(() => validateKeys(schema, 'pk_uuid', 'id', [randomUUID(), NaN, randomUUID()])).toThrowError(
				InvalidPayloadError,
			);

			expect(() => validateKeys(schema, 'pk_uuid', 'id', [randomUUID(), 111, randomUUID()])).toThrowError(
				InvalidPayloadError,
			);
		});

		it('Does not throw an error when provided with a valid uuid key', () => {
			expect(() => validateKeys(schema, 'pk_uuid', 'id', randomUUID())).not.toThrowError();
		});

		it('Does not throw an error when provided with an array of valid uuid keys', () => {
			expect(() =>
				validateKeys(schema, 'pk_uuid', 'id', [randomUUID(), randomUUID(), randomUUID()]),
			).not.toThrowError();
		});
	});
});
