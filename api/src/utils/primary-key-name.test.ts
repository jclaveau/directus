import { SchemaBuilder } from '@directus/schema-builder';
import { expect, test } from 'vitest';
import { primaryKeyNameOf } from './primary-key-name.js';

const keyedSchema = new SchemaBuilder()
	.collection('integer_keyed', (c) => {
		c.field('id').id();
	})
	.collection('big_integer_keyed', (c) => {
		c.field('id')
			.bigInteger()
			.primary();
	})
	.collection('uuid_keyed', (c) => {
		c.field('id')
			.uuid()
			.primary();
	})
	.collection('string_keyed', (c) => {
		c.field('id')
			.string()
			.primary();
	})
	.build();

test.each([
	{ key: 7, keyCollection: 'integer_keyed', keyName: '7' },
	{ key: '007', keyCollection: 'integer_keyed', keyName: '7' },
	{ key: 'abc', keyCollection: 'integer_keyed', keyName: 'abc' },
	{
		key: '9007199254740993',
		keyCollection: 'big_integer_keyed',
		keyName: '9007199254740993',
	},
	{
		key: '0009007199254740993',
		keyCollection: 'big_integer_keyed',
		keyName: '9007199254740993',
	},
	{
		key: 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11',
		keyCollection: 'uuid_keyed',
		keyName: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
	},
	{ key: '007', keyCollection: 'string_keyed', keyName: '007' },
	{ key: 'Abc', keyCollection: 'string_keyed', keyName: 'Abc' },
])('names $key of $keyCollection as $keyName', ({ key, keyCollection, keyName }) => {
	expect(primaryKeyNameOf(key, keyCollection, keyedSchema)).toBe(keyName);
});
