import { oneLine } from '@directus/utils';
import { describe, expect, it } from 'vitest';
import {
	findRelationalSpecial,
	unnamedRelationalAliasReason,
} from './relational-alias.js';

describe('findRelationalSpecial', () => {
	it.each([
		{ fieldSpecial: 'cast-json,m2m', relationalSpecial: 'm2m' },
		{ fieldSpecial: ['files'], relationalSpecial: 'files' },
		{ fieldSpecial: 'alias,no-data', relationalSpecial: undefined },
		{ fieldSpecial: 'file', relationalSpecial: undefined },
		{ fieldSpecial: null, relationalSpecial: undefined },
		{ fieldSpecial: undefined, relationalSpecial: undefined },
	])(oneLine`
		reads $fieldSpecial as $relationalSpecial
	`, ({ fieldSpecial, relationalSpecial }) => {
		expect(findRelationalSpecial(fieldSpecial)).toBe(relationalSpecial);
	});
});

describe('unnamedRelationalAliasReason', () => {
	it('names a files alias with its article', () => {
		expect(unnamedRelationalAliasReason('pin_owner', 'photos', 'files')).toBe(
			'Field "photos" of "pin_owner" is a files alias no relation names'
			+ ' in one_field.',
		);
	});
});
