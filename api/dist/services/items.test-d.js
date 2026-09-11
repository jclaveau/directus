import { test } from "../node_modules/.pnpm/@vitest_runner@3.2.6/node_modules/@vitest/runner/dist/chunk-hooks.js";
import { import_dist } from "../node_modules/.pnpm/vitest@3.2.6_@types_node@22.19.21_happy-dom@18.0.1_jiti@2.7.0_jsdom@20.0.3_sass-embedde_bc017d723538143d118dda13d4a37a91/node_modules/vitest/dist/index.js";

//#region src/services/items.test-d.ts
const service = {};
test("createOne resolves to a primary key by default", () => {
	(0, import_dist.expectTypeOf)(service.createOne({})).toEqualTypeOf();
});
test("createOne may resolve to null when filter cancel is opted in", () => {
	(0, import_dist.expectTypeOf)(service.createOne({}, { allowFilterCancel: true })).toEqualTypeOf();
});

//#endregion
export {  };