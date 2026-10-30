import type {
	CreateEntries,
	CreateEntry,
	DeleteKey,
	DeleteKeys,
	EventContext,
	FilterHandler,
	MutationEventContext,
	PrimaryKey,
	ReadEventContext,
	RegisterFunctions,
	ScopedCachePurgeHandle,
	ScopedCacheScopeHandle,
	UpdateEntries,
	UpdateEntry,
	UpdateGroup,
	WrittenEventContext,
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

// A key arrives as the request spelled it ("5") and may be a uuid.
test('register.filter hands an item-typed delete its keys as PrimaryKey', () => {
	const register = {} as RegisterFunctions;
	const tableName = 'article';

	register.filter<{ id: number; title: string }>(
		`${tableName}.items.delete`,
		(keys) => {
			expectTypeOf(keys).toEqualTypeOf<PrimaryKey[] | null>();
			return keys;
		},
	);

	register.filter<{ id: string }>('users.delete', (keys) => {
		expectTypeOf(keys).toEqualTypeOf<PrimaryKey[] | null>();
	});
});

test('DeleteKeys is the list of DeleteKey', () => {
	expectTypeOf<DeleteKey>().toEqualTypeOf<PrimaryKey>();
	expectTypeOf<DeleteKeys>().toEqualTypeOf<PrimaryKey[]>();
});

test('the list aliases name what a grouped filter receives, null aside', () => {
	expectTypeOf<CreateEntries<Item>>().toEqualTypeOf<(CreateEntry<Item> | null)[]>();
	expectTypeOf<UpdateEntries<Item>>().toEqualTypeOf<UpdateEntry<Item>[]>();
});

test('register.filter hands its entries to a helper typed by a list alias', () => {
	const register = {} as RegisterFunctions;
	const prepareCreateEntries = (createEntries: CreateEntries<Item>) => createEntries;
	const prepareUpdateEntries = (updateEntries: UpdateEntries<Item>) => updateEntries;

	register.filter<Item>(
		'article.items.create',
		(entries) => entries && prepareCreateEntries(entries),
	);

	register.filter<Item>(
		'article.items.update',
		(entries) => entries && prepareUpdateEntries(entries),
	);
});

test('register.filter keeps the payload type on every other event', () => {
	const register = {} as RegisterFunctions;
	const tableName = 'article';
	const event: string = 'auth.login';

	register.filter<Item[]>(`${tableName}.items.read`, (rows) => {
		expectTypeOf(rows).toEqualTypeOf<Item[]>();
		return rows;
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

// emitFilter keeps the payload when a handler answers undefined.
test('register.filter takes an item handler that returns nothing', () => {
	const register = {} as RegisterFunctions;

	register.filter<Item>('article.items.create', (_entries, _meta, context) => {
		expectTypeOf(context).toEqualTypeOf<MutationEventContext>();
	});

	register.filter<Item>('article.items.update', (_entries, _meta, context) => {
		expectTypeOf(context).toEqualTypeOf<MutationEventContext>();
	});

	register.filter('article.items.delete', (_keys, _meta, context) => {
		expectTypeOf(context).toEqualTypeOf<MutationEventContext>();
	});

	register.filter('article.items.read', (_rows, _meta, context) => {
		expectTypeOf(context).toEqualTypeOf<ReadEventContext>();
	});
});

test('register.filter refuses an item handler that fits no item overload', () => {
	const register = {} as RegisterFunctions;

	// @ts-expect-error -- a create answers its list, not a row
	register.filter('article.items.create', () => ({ a: 1 }));

	// @ts-expect-error -- an update answers its list, not a row
	register.filter('users.update', () => ({ a: 1 }));
});

test('register.filter leaves the handle optional on a bare or runtime event', () => {
	const register = {} as RegisterFunctions;
	const event: string = 'auth.login';

	register.filter('auth.create', (_payload, _meta, context) => {
		expectTypeOf(context.scopedCache).toEqualTypeOf<
			| ScopedCacheScopeHandle
			| ScopedCachePurgeHandle
			| Pick<ScopedCachePurgeHandle, 'purgeBy'>
			| undefined
		>();
	});

	register.filter(event, (_payload, _meta, context) => {
		expectTypeOf(context.scopedCache).toEqualTypeOf<
			| ScopedCacheScopeHandle
			| ScopedCachePurgeHandle
			| Pick<ScopedCachePurgeHandle, 'purgeBy'>
			| undefined
		>();
	});
});

test('register.filter types a created event by the rows it wrote', () => {
	const register = {} as RegisterFunctions;

	register.filter<Item>('article.items.created', (rows, _meta, context) => {
		expectTypeOf(rows).toEqualTypeOf<Item[]>();
		expectTypeOf(context).toEqualTypeOf<WrittenEventContext>();
	});

	register.filter('users.created', (rows, _meta, context) => {
		expectTypeOf(rows).toEqualTypeOf<Record<string, any>[]>();
		expectTypeOf(context.transaction).toEqualTypeOf<Knex>();
	});
});

test('register.filter types an updated event by the groups it applied', () => {
	const register = {} as RegisterFunctions;

	register.filter<Item>('items.updated', (groups, _meta, context) => {
		expectTypeOf(groups).toEqualTypeOf<UpdateGroup<Item>[]>();
		expectTypeOf(context).toEqualTypeOf<WrittenEventContext>();
	});

	register.filter('users.updated', (groups) => {
		expectTypeOf(groups).toEqualTypeOf<UpdateGroup<Record<string, any>>[]>();
	});
});

test('register.filter refuses a written handler answering anything', () => {
	const register = {} as RegisterFunctions;

	// @ts-expect-error -- the rows are written: a created hook answers nothing
	register.filter('article.items.created', () => ({ a: 1 }));

	// @ts-expect-error -- the rows are written: an updated hook answers nothing
	register.filter('users.updated', () => ({ a: 1 }));

	// @ts-expect-error -- the rows are written: a created hook answers nothing
	register.filter('article.items.created', (rows) => rows);

	// @ts-expect-error -- the rows are written: an updated hook answers nothing
	register.filter('items.updated', async (groups) => groups);
});

test('register.filter takes a written handler answering nothing', () => {
	const register = {} as RegisterFunctions;

	register.filter('article.items.created', () => {});

	register.filter('items.updated', async () => {});
});

test('register.filter hands a written handler no skipPurgeFor', () => {
	const register = {} as RegisterFunctions;

	register.filter('items.updated', (_groups, _meta, context) => {
		// @ts-expect-error -- the rows are written: no take-over to declare inert
		context.scopedCache.skipPurgeFor(1);
	});
});
