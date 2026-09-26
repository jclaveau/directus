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
	(0, import_dist.expectTypeOf)(emitter_default.emitFilter("items.create", { a: 1 }, {})).toEqualTypeOf();
});
test("emitFilter defaults the output type to the input type", () => {
	(0, import_dist.expectTypeOf)(emitter_default.emitFilter("items.update", { a: 1 }, {})).toEqualTypeOf();
});
test("onFilter accepts a handler whose output type differs from its input", () => {
	emitter_default.onFilter("items.create", (payload) => {
		(0, import_dist.expectTypeOf)(payload).toEqualTypeOf();
		return 5;
	});
});
test("register.filter plumbs the output type so a hook can return a primary key", () => {
	({}).filter("items.create", (payload) => {
		(0, import_dist.expectTypeOf)(payload).toEqualTypeOf();
		return 5;
	});
});
test("offFilter accepts the same typed handler shape as onFilter", () => {
	const handler = (payload) => {
		(0, import_dist.expectTypeOf)(payload).toEqualTypeOf();
		return 5;
	};
	emitter_default.onFilter("items.create", handler);
	emitter_default.offFilter("items.create", handler);
});
test("register.filter hands a read handler the read handle, unnarrowed", () => {
	({}).filter(`article.items.read`, async (rows, _, context) => {
		(0, import_dist.expectTypeOf)(context.scopedCache).toEqualTypeOf();
		return context.scopedCache.dependOn(Promise.resolve(rows));
	});
});
test("register.filter hands a mutation handler the purge handle", () => {
	({}).filter("items.update", (payload, _meta, context) => {
		(0, import_dist.expectTypeOf)(context.scopedCache).toEqualTypeOf();
		context.scopedCache.purgeBy({ collection: "article" });
		return payload;
	});
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

//#endregion
export {  };