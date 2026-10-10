import type {
	CreateEntry,
	FilterHandler,
	RegisterFunctions,
	ScopedCachePurgeHandle,
	ScopedCacheScopeHandle,
	UpdateGroup,
} from '@directus/types';
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
	expectTypeOf(emitter.emitFilter<Item, number>('items.create.one', { a: 1 }, {}))
		.toEqualTypeOf<Promise<Item | number>>();
});

test('emitFilter defaults the output type to the input type', () => {
	expectTypeOf(emitter.emitFilter<UpdateGroup<Item>[]>(
		'items.update',
		[{ data: { a: 1 }, keys: [1] }],
		{},
	)).toEqualTypeOf<Promise<UpdateGroup<Item>[]>>();
});

test('onFilter accepts a handler whose output type differs from its input', () => {
	emitter.onFilter<Item, number>('items.create.one', (payload) => {
		expectTypeOf(payload).toEqualTypeOf<Item>();
		return 5;
	});
});

test('register.filter plumbs the output type so a hook can return a primary key', () => {
	const register = {} as RegisterFunctions;

	register.filter<Item, number>('items.create.one', (payload) => {
		expectTypeOf(payload).toEqualTypeOf<Item>();
		return 5;
	});
});

test('offFilter accepts the same typed handler shape as onFilter', () => {
	const handler: FilterHandler<Item, number> = (payload) => {
		expectTypeOf(payload).toEqualTypeOf<Item>();
		return 5;
	};

	emitter.onFilter<Item, number>('items.create.one', handler);
	emitter.offFilter<Item, number>('items.create.one', handler);
});

test('register.filter hands a read handler the read handle, unnarrowed', () => {
	const register = {} as RegisterFunctions;
	const collection = 'article';

	register.filter<Item[]>(`${collection}.items.read`, async (rows, _, context) => {
		expectTypeOf(context.scopedCache).toEqualTypeOf<ScopedCacheScopeHandle>();
		return context.scopedCache.dependOn(Promise.resolve(rows));
	});
});

test('register.filter hands a mutation handler the purge handle', () => {
	const register = {} as RegisterFunctions;

	register.filter('items.update', (groups, _meta, context) => {
		expectTypeOf(context.scopedCache).toEqualTypeOf<ScopedCachePurgeHandle>();
		context.scopedCache.purgeBy({ collection: 'article' });
		return groups;
	});
});

test('register.filter hands a per-row handler the purge handle', () => {
	const register = {} as RegisterFunctions;

	register.filter<Item>('items.update.one', (payload, _meta, context) => {
		expectTypeOf(context.scopedCache).toEqualTypeOf<ScopedCachePurgeHandle>();
		return payload;
	});

	register.filter<Item>('articles.items.create.one', (payload, _meta, context) => {
		expectTypeOf(context.scopedCache).toEqualTypeOf<ScopedCachePurgeHandle>();
		return payload;
	});
});

test('register.filter types a grouped event by the list it carries', () => {
	const register = {} as RegisterFunctions;

	register.filter('users.update', (groups) => {
		expectTypeOf(groups).toEqualTypeOf<UpdateGroup[]>();
	});

	register.filter('articles.items.create', (entries) => {
		expectTypeOf(entries).toEqualTypeOf<CreateEntry[]>();
	});
});

test('register.filter leaves the handle optional on a bare or runtime event', () => {
	const register = {} as RegisterFunctions;
	const event: string = 'auth.login';

	register.filter('auth.create', (_payload, _meta, context) => {
		expectTypeOf(context.scopedCache).toEqualTypeOf<
			ScopedCacheScopeHandle | ScopedCachePurgeHandle | undefined
		>();
	});

	register.filter(event, (_payload, _meta, context) => {
		expectTypeOf(context.scopedCache).toEqualTypeOf<
			ScopedCacheScopeHandle | ScopedCachePurgeHandle | undefined
		>();
	});
});
