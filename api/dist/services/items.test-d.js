import { test } from "../node_modules/.pnpm/@vitest_runner@4.1.11/node_modules/@vitest/runner/dist/chunk-artifact.js";
import { import_dist } from "../node_modules/.pnpm/vitest@4.1.11_@opentelemetry_api@1.9.1_@types_node@22.20.1_@vitest_coverage-v8@4.1.11_h_be7bb46863096290da74dd5c74fc716c/node_modules/vitest/dist/index.js";

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