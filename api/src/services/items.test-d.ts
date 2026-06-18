import type { PrimaryKey } from '@directus/types';
import { expectTypeOf, test } from 'vitest';
import { ItemsService } from './items.js';

const service = {} as ItemsService;

test('createOne resolves to a primary key by default', () => {
	expectTypeOf(service.createOne({})).toEqualTypeOf<Promise<PrimaryKey>>();
});

test('createOne may resolve to null when filter cancel is opted in', () => {
	expectTypeOf(service.createOne({}, { allowFilterCancel: true })).toEqualTypeOf<Promise<PrimaryKey | null>>();
});
