import emitter_default from "./emitter.js";
import { test } from "./node_modules/.pnpm/@vitest_runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js";
import { import_dist } from "./node_modules/.pnpm/vitest@3.2.6_@types_node@22.19.21_happy-dom@18.0.1_jiti@2.7.0_jsdom@20.0.3_sass-embedde_bc017d723538143d118dda13d4a37a91/node_modules/vitest/dist/index.js";

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

//#endregion
export {  };