import { getHelpers } from "../../../helpers/index.js";

//#region src/database/run-ast/lib/apply-query/pagination.ts
function applyLimit(knex, rootQuery, limit) {
	if (typeof limit === "number") getHelpers(knex).schema.applyLimit(rootQuery, limit);
}
function applyOffset(knex, rootQuery, offset) {
	if (typeof offset === "number") getHelpers(knex).schema.applyOffset(rootQuery, offset);
}

//#endregion
export { applyLimit, applyOffset };