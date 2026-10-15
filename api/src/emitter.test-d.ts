import type {
	CreateEntry,
	EventContext,
	FilterHandler,
	MutationEventContext,
	PrimaryKey,
	ReadEventContext,
	RegisterFunctions,
	ScopedCachePurgeHandle,
	ScopedCacheScopeHandle,
	UpdateEntry,
	UpdateGroup,
} from '@directus/types';
import type { Knex } from 'knex';
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
	expectTypeOf(emitter.emitFilter<Item, number>('items.delete', { a: 1 }, {}))
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
	emitter.onFilter<Item, number>('items.delete', (payload) => {
		expectTypeOf(payload).toEqualTypeOf<Item>();
		return 5;
	});
});

test('register.filter plumbs the output type so a hook can return a primary key', () => {
	const register = {} as RegisterFunctions;

	register.filter<Item, number>('items.delete', (payload) => {
		expectTypeOf(payload).toEqualTypeOf<Item>();
		return 5;
	});
});

test('offFilter accepts the same typed handler shape as onFilter', () => {
	const handler: FilterHandler<Item, number> = (payload) => {
		expectTypeOf(payload).toEqualTypeOf<Item>();
		return 5;
	};

	emitter.onFilter<Item, number>('items.delete', handler);
	emitter.offFilter<Item, number>('items.delete', handler);
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

test('register.filter hands a mutation handler its transaction', () => {
	const register = {} as RegisterFunctions;

	register.filter('items.update', (groups, _meta, context) => {
		expectTypeOf(context.transaction).toEqualTypeOf<Knex>();
		return groups;
	});

	register.filter('items.delete', (keys, _meta, context) => {
		expectTypeOf(context.transaction).toEqualTypeOf<Knex>();
		return keys;
	});
});

test('register.filter hands a system collection mutation its transaction', () => {
	const register = {} as RegisterFunctions;

	register.filter('users.update', (groups, _meta, context) => {
		expectTypeOf(context).toEqualTypeOf<MutationEventContext>();
		expectTypeOf(context.transaction).toEqualTypeOf<Knex>();
		expectTypeOf(context.scopedCache).toEqualTypeOf<ScopedCachePurgeHandle>();
		return groups;
	});

	register.filter('items.update', (groups, _meta, context) => {
		expectTypeOf(context).toEqualTypeOf<MutationEventContext>();
		return groups;
	});

	register.filter('articles.items.delete', (keys, _meta, context) => {
		expectTypeOf(context).toEqualTypeOf<MutationEventContext>();
		return keys;
	});
});

test('register.filter hands a read context only to an item or system read', () => {
	const register = {} as RegisterFunctions;

	register.filter('users.read', (rows, _meta, context) => {
		expectTypeOf(context).toEqualTypeOf<ReadEventContext>();
		return rows;
	});

	register.filter('articles.items.read', (rows, _meta, context) => {
		expectTypeOf(context).toEqualTypeOf<ReadEventContext>();
		return rows;
	});
});

test('register.filter hands an event no service emits the plain context', () => {
	const register = {} as RegisterFunctions;

	register.filter('myapp.update', (payload, _meta, context) => {
		expectTypeOf(context).toEqualTypeOf<EventContext>();
		return payload;
	});

	register.filter('myapp.read', (payload, _meta, context) => {
		expectTypeOf(context).toEqualTypeOf<EventContext>();
		return payload;
	});

	register.filter('fields.update', (payload, _meta, context) => {
		expectTypeOf(context).toEqualTypeOf<EventContext>();
		return payload;
	});
});

// null as a whole is an earlier filter cancelling the mutation; a null create
// entry is one cancelling that row.
test('register.filter types a grouped event by the list it carries', () => {
	const register = {} as RegisterFunctions;

	register.filter('users.update', (groups) => {
		expectTypeOf(groups).toEqualTypeOf<UpdateEntry[] | null>();
	});

	register.filter('articles.items.create', (entries) => {
		expectTypeOf(entries).toEqualTypeOf<(CreateEntry | null)[] | null>();
	});
});

test('register.filter types a delete by the keys it carries', () => {
	const register = {} as RegisterFunctions;

	register.filter('articles.items.delete', (keys) => {
		expectTypeOf(keys).toEqualTypeOf<PrimaryKey[] | null>();
	});

	register.filter('users.delete', (keys) => {
		expectTypeOf(keys).toEqualTypeOf<PrimaryKey[] | null>();
	});
});

test('register.filter wraps the item type in a grouped event list', () => {
	const register = {} as RegisterFunctions;
	const tableName = 'article';

	register.filter<Item>(`${tableName}.items.create`, (entries) => {
		expectTypeOf(entries).toEqualTypeOf<(CreateEntry<Item> | null)[] | null>();
		return entries;
	});

	register.filter<Item>(`${tableName}.items.update`, (entries) => {
		expectTypeOf(entries).toEqualTypeOf<UpdateEntry<Item>[] | null>();
		return entries;
	});
});

test('register.filter keeps the payload type on every other event', () => {
	const register = {} as RegisterFunctions;
	const tableName = 'article';
	const event: string = 'auth.login';

	register.filter<Item[]>(`${tableName}.items.read`, (rows) => {
		expectTypeOf(rows).toEqualTypeOf<Item[]>();
		return rows;
	});

	register.filter<number[]>(`${tableName}.items.delete`, (keys) => {
		expectTypeOf(keys).toEqualTypeOf<number[]>();
		return keys;
	});

	register.filter<Item>('fields.create', (payload) => {
		expectTypeOf(payload).toEqualTypeOf<Item>();
		return payload;
	});

	register.filter<Item>(event, (payload) => {
		expectTypeOf(payload).toEqualTypeOf<Item>();
		return payload;
	});
});

test('register.filter refuses a create handler that drops a row', () => {
	const register = {} as RegisterFunctions;

	// @ts-expect-error -- a create answers every position, cancelled ones as null
	register.filter<Item>('article.items.create', (entries) => entries?.[0]);
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
