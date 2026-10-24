import { expect, test } from 'vitest';
import { messageConstructor } from './item-not-found.js';

test('names the key and the collection it is missing from', () => {
	expect(messageConstructor({
		collection: 'articles',
		primaryKey: 999,
	})).toBe('Item "999" doesn\'t exist in collection "articles".');
});
