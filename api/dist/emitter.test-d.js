import emitter_default from "./emitter.js";
import { test } from "./node_modules/.pnpm/@vitest_runner@4.1.11/node_modules/@vitest/runner/dist/chunk-artifact.js";
import { import_dist } from "./node_modules/.pnpm/vitest@4.1.11_@opentelemetry_api@1.9.1_@types_node@22.20.1_@vitest_coverage-v8@4.1.11_h_be7bb46863096290da74dd5c74fc716c/node_modules/vitest/dist/index.js";

//#region src/emitter.test-d.ts
test("FilterHandler defaults TOut to TIn (backward compatible)", () => {
	(0, import_dist.expectTypeOf)().toEqualTypeOf();
});
test("FilterHandler keeps the input type on its payload parameter", () => {
	(0, import_dist.expectTypeOf)().toEqualTypeOf();
});
test("FilterHandler widens its return to TIn | TOut", () => {
	(0, import_dist.expectTypeOf)().toEqualTypeOf();
});
test("a filter may return the output type instead of the payload", () => {
	const cancel = (payload) => {
		(0, import_dist.expectTypeOf)(payload).toEqualTypeOf();
		return 5;
	};
	(0, import_dist.expectTypeOf)(cancel).toEqualTypeOf();
});
test("emitFilter surfaces the output type alongside the input", () => {
	(0, import_dist.expectTypeOf)(emitter_default.emitFilter("items.delete", { a: 1 }, {})).toEqualTypeOf();
});
test("emitFilter defaults the output type to the input type", () => {
	(0, import_dist.expectTypeOf)(emitter_default.emitFilter("items.update", [{
		data: { a: 1 },
		keys: [1]
	}], {})).toEqualTypeOf();
});
test("onFilter accepts a handler whose output type differs from its input", () => {
	emitter_default.onFilter("items.delete", (payload) => {
		(0, import_dist.expectTypeOf)(payload).toEqualTypeOf();
		return 5;
	});
});
test("register.filter plumbs the output type so a hook can return a primary key", () => {
	({}).filter("items.delete", (payload) => {
		(0, import_dist.expectTypeOf)(payload).toEqualTypeOf();
		return 5;
	});
});
test("offFilter accepts the same typed handler shape as onFilter", () => {
	const handler = (payload) => {
		(0, import_dist.expectTypeOf)(payload).toEqualTypeOf();
		return 5;
	};
	emitter_default.onFilter("items.delete", handler);
	emitter_default.offFilter("items.delete", handler);
});
test("register.filter hands a read handler the read handle, unnarrowed", () => {
	({}).filter(`article.items.read`, async (rows, _, context) => {
		(0, import_dist.expectTypeOf)(context.scopedCache).toEqualTypeOf();
		return context.scopedCache.dependOn(Promise.resolve(rows));
	});
});
test("register.filter hands a mutation handler the purge handle", () => {
	({}).filter("items.update", (groups, _meta, context) => {
		(0, import_dist.expectTypeOf)(context.scopedCache).toEqualTypeOf();
		context.scopedCache.purgeBy({ collection: "article" });
		return groups;
	});
});
test("register.filter hands a mutation handler its transaction", () => {
	const register = {};
	register.filter("items.update", (groups, _meta, context) => {
		(0, import_dist.expectTypeOf)(context.transaction).toEqualTypeOf();
		return groups;
	});
	register.filter("items.delete", (keys, _meta, context) => {
		(0, import_dist.expectTypeOf)(context.transaction).toEqualTypeOf();
		return keys;
	});
});
test("register.filter hands a system collection mutation its transaction", () => {
	const register = {};
	register.filter("users.update", (groups, _meta, context) => {
		(0, import_dist.expectTypeOf)(context).toEqualTypeOf();
		(0, import_dist.expectTypeOf)(context.transaction).toEqualTypeOf();
		(0, import_dist.expectTypeOf)(context.scopedCache).toEqualTypeOf();
		return groups;
	});
	register.filter("items.update", (groups, _meta, context) => {
		(0, import_dist.expectTypeOf)(context).toEqualTypeOf();
		return groups;
	});
	register.filter("articles.items.delete", (keys, _meta, context) => {
		(0, import_dist.expectTypeOf)(context).toEqualTypeOf();
		return keys;
	});
});
test("register.filter hands a read context only to an item or system read", () => {
	const register = {};
	register.filter("users.read", (rows, _meta, context) => {
		(0, import_dist.expectTypeOf)(context).toEqualTypeOf();
		return rows;
	});
	register.filter("articles.items.read", (rows, _meta, context) => {
		(0, import_dist.expectTypeOf)(context).toEqualTypeOf();
		return rows;
	});
});
test("register.filter hands an event no service emits the plain context", () => {
	const register = {};
	register.filter("myapp.update", (payload, _meta, context) => {
		(0, import_dist.expectTypeOf)(context).toEqualTypeOf();
		return payload;
	});
	register.filter("myapp.read", (payload, _meta, context) => {
		(0, import_dist.expectTypeOf)(context).toEqualTypeOf();
		return payload;
	});
	register.filter("fields.update", (payload, _meta, context) => {
		(0, import_dist.expectTypeOf)(context).toEqualTypeOf();
		return payload;
	});
});
test("register.filter types a grouped event by the list it carries", () => {
	const register = {};
	register.filter("users.update", (groups) => {
		(0, import_dist.expectTypeOf)(groups).toEqualTypeOf();
	});
	register.filter("articles.items.create", (entries) => {
		(0, import_dist.expectTypeOf)(entries).toEqualTypeOf();
	});
});
test("register.filter types a delete by the keys it carries", () => {
	const register = {};
	register.filter("articles.items.delete", (keys) => {
		(0, import_dist.expectTypeOf)(keys).toEqualTypeOf();
	});
	register.filter("users.delete", (keys) => {
		(0, import_dist.expectTypeOf)(keys).toEqualTypeOf();
	});
});
test("register.filter wraps the item type in a grouped event list", () => {
	const register = {};
	const tableName = "article";
	register.filter(`${tableName}.items.create`, (entries) => {
		(0, import_dist.expectTypeOf)(entries).toEqualTypeOf();
		return entries;
	});
	register.filter(`${tableName}.items.update`, (entries) => {
		(0, import_dist.expectTypeOf)(entries).toEqualTypeOf();
		return entries;
	});
});
test("register.filter hands an item-typed delete its keys as PrimaryKey", () => {
	const register = {};
	register.filter(`article.items.delete`, (keys) => {
		(0, import_dist.expectTypeOf)(keys).toEqualTypeOf();
		return keys;
	});
	register.filter("users.delete", (keys) => {
		(0, import_dist.expectTypeOf)(keys).toEqualTypeOf();
	});
});
test("DeleteKeys is the list of DeleteKey", () => {
	(0, import_dist.expectTypeOf)().toEqualTypeOf();
	(0, import_dist.expectTypeOf)().toEqualTypeOf();
});
test("the list aliases name what a grouped filter receives, null aside", () => {
	(0, import_dist.expectTypeOf)().toEqualTypeOf();
	(0, import_dist.expectTypeOf)().toEqualTypeOf();
});
test("register.filter hands its entries to a helper typed by a list alias", () => {
	const register = {};
	const prepareCreateEntries = (createEntries) => createEntries;
	const prepareUpdateEntries = (updateEntries) => updateEntries;
	register.filter("article.items.create", (entries) => entries && prepareCreateEntries(entries));
	register.filter("article.items.update", (entries) => entries && prepareUpdateEntries(entries));
});
test("register.filter keeps the payload type on every other event", () => {
	const register = {};
	const tableName = "article";
	const event = "auth.login";
	register.filter(`${tableName}.items.read`, (rows) => {
		(0, import_dist.expectTypeOf)(rows).toEqualTypeOf();
		return rows;
	});
	register.filter("fields.create", (payload) => {
		(0, import_dist.expectTypeOf)(payload).toEqualTypeOf();
		return payload;
	});
	register.filter(event, (payload) => {
		(0, import_dist.expectTypeOf)(payload).toEqualTypeOf();
		return payload;
	});
});
test("register.filter takes an item handler that returns nothing", () => {
	const register = {};
	register.filter("article.items.create", (_entries, _meta, context) => {
		(0, import_dist.expectTypeOf)(context).toEqualTypeOf();
	});
	register.filter("article.items.update", (_entries, _meta, context) => {
		(0, import_dist.expectTypeOf)(context).toEqualTypeOf();
	});
	register.filter("article.items.delete", (_keys, _meta, context) => {
		(0, import_dist.expectTypeOf)(context).toEqualTypeOf();
	});
	register.filter("article.items.read", (_rows, _meta, context) => {
		(0, import_dist.expectTypeOf)(context).toEqualTypeOf();
	});
});
test("register.filter refuses an item handler that fits no item overload", () => {
	const register = {};
	register.filter("article.items.create", () => ({ a: 1 }));
	register.filter("users.update", () => ({ a: 1 }));
});
test("register.filter leaves the handle optional on a bare or runtime event", () => {
	const register = {};
	const event = "auth.login";
	register.filter("auth.create", (_payload, _meta, context) => {
		(0, import_dist.expectTypeOf)(context.scopedCache).toEqualTypeOf();
	});
	register.filter(event, (_payload, _meta, context) => {
		(0, import_dist.expectTypeOf)(context.scopedCache).toEqualTypeOf();
	});
});
test("register.filter types a created event by the rows it wrote", () => {
	const register = {};
	register.filter("article.items.created", (rows, _meta, context) => {
		(0, import_dist.expectTypeOf)(rows).toEqualTypeOf();
		(0, import_dist.expectTypeOf)(context).toEqualTypeOf();
	});
	register.filter("users.created", (rows, _meta, context) => {
		(0, import_dist.expectTypeOf)(rows).toEqualTypeOf();
		(0, import_dist.expectTypeOf)(context.transaction).toEqualTypeOf();
	});
});
test("register.filter types an updated event by the groups it applied", () => {
	const register = {};
	register.filter("items.updated", (groups, _meta, context) => {
		(0, import_dist.expectTypeOf)(groups).toEqualTypeOf();
		(0, import_dist.expectTypeOf)(context).toEqualTypeOf();
	});
	register.filter("users.updated", (groups) => {
		(0, import_dist.expectTypeOf)(groups).toEqualTypeOf();
	});
});
test("register.filter refuses a written handler answering anything", () => {
	const register = {};
	register.filter("article.items.created", () => ({ a: 1 }));
	register.filter("users.updated", () => ({ a: 1 }));
	register.filter("article.items.created", (rows) => rows);
	register.filter("items.updated", async (groups) => groups);
});
test("register.filter takes a written handler answering nothing", () => {
	const register = {};
	register.filter("article.items.created", () => {});
	register.filter("items.updated", async () => {});
});
test("register.filter hands a written handler no skipPurgeFor", () => {
	({}).filter("items.updated", (_groups, _meta, context) => {
		context.scopedCache.skipPurgeFor(1);
	});
});

//#endregion
export {  };