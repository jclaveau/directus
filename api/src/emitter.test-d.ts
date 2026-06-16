import type { FilterHandler, RegisterFunctions } from '@directus/types';
import { expectTypeOf, test } from 'vitest';
import emitter from './emitter.js';

type Item = { a: number };

test('FilterHandler defaults TOut to TIn (backward compatible)', () => {
	expectTypeOf<FilterHandler<Item>>().toEqualTypeOf<FilterHandler<Item, Item>>();
});

test('FilterHandler keeps the input type on its payload parameter', () => {
	expectTypeOf<Parameters<FilterHandler<Item, number>>[0]>().toEqualTypeOf<Item>();
});

test('FilterHandler widens its return to TIn | TOut', () => {
	expectTypeOf<ReturnType<FilterHandler<Item, number>>>().toEqualTypeOf<Item | number | Promise<Item | number>>();
});

test('a filter may return the output type instead of the payload', () => {
	const cancel: FilterHandler<Item, number> = (payload) => {
		expectTypeOf(payload).toEqualTypeOf<Item>();
		return 5;
	};

	expectTypeOf(cancel).toEqualTypeOf<FilterHandler<Item, number>>();
});

test('emitFilter surfaces the output type alongside the input', () => {
	const result = emitter.emitFilter<Item, number>('items.create', { a: 1 }, {});
	expectTypeOf(result).toEqualTypeOf<Promise<Item | number>>();
});

test('emitFilter defaults the output type to the input type', () => {
	const result = emitter.emitFilter<Item>('items.update', { a: 1 }, {});
	expectTypeOf(result).toEqualTypeOf<Promise<Item>>();
});

test('onFilter accepts a handler whose output type differs from its input', () => {
	emitter.onFilter<Item, number>('items.create', (payload) => {
		expectTypeOf(payload).toEqualTypeOf<Item>();
		return 5;
	});
});

test('register.filter plumbs the output type so a hook can return a primary key', () => {
	const register = {} as RegisterFunctions;

	register.filter<Item, number>('items.create', (payload) => {
		expectTypeOf(payload).toEqualTypeOf<Item>();
		return 5;
	});
});
