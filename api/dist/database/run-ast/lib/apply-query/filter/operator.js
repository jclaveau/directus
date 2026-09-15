import { getColumn } from "../../../utils/get-column.js";
import { getHelpers } from "../../../../helpers/index.js";
import { getOutputTypeForFunction } from "@directus/utils";

//#region src/database/run-ast/lib/apply-query/filter/operator.ts
function applyOperator(knex, dbQuery, schema, key, operator, compareValue, logical = "and", originalCollectionName) {
	const helpers = getHelpers(knex);
	const [table, column] = key.split(".");
	const selectionRaw = getColumn(knex, table, column, false, schema, { originalCollectionName });
	if (operator === "_null" && compareValue !== false || operator === "_nnull" && compareValue === false || operator === "_eq" && compareValue === null) {
		dbQuery[logical].whereNull(selectionRaw);
		return;
	}
	if (operator === "_nnull" && compareValue !== false || operator === "_null" && compareValue === false || operator === "_neq" && compareValue === null) {
		dbQuery[logical].whereNotNull(selectionRaw);
		return;
	}
	if (operator === "_empty" && compareValue !== false || operator === "_nempty" && compareValue === false) dbQuery[logical].andWhere((query) => {
		query.whereNull(key).orWhere(key, "=", "");
	});
	if (operator === "_nempty" && compareValue !== false || operator === "_empty" && compareValue === false) dbQuery[logical].andWhere((query) => {
		query.whereNotNull(key).andWhere(key, "!=", "");
	});
	if (compareValue === void 0) return;
	if (Array.isArray(compareValue)) compareValue = compareValue.filter((val) => val !== void 0);
	if (column.includes("(") && column.includes(")")) {
		const functionName = column.split("(")[0];
		const type = getOutputTypeForFunction(functionName);
		if ([
			"integer",
			"float",
			"decimal"
		].includes(type)) compareValue = Array.isArray(compareValue) ? compareValue.map(Number) : Number(compareValue);
	}
	const [collection, field] = key.split(".");
	const mappedCollection = originalCollectionName || collection;
	if (mappedCollection in schema.collections && field in schema.collections[mappedCollection].fields) {
		const type = schema.collections[mappedCollection].fields[field].type;
		if ([
			"date",
			"dateTime",
			"time",
			"timestamp"
		].includes(type)) if (Array.isArray(compareValue)) compareValue = compareValue.map((val) => helpers.date.parse(val));
		else compareValue = helpers.date.parse(compareValue);
		if ([
			"integer",
			"float",
			"decimal"
		].includes(type)) if (Array.isArray(compareValue)) compareValue = compareValue.map((val) => Number(val));
		else compareValue = Number(compareValue);
	}
	if (operator === "_eq") dbQuery[logical].where(selectionRaw, "=", compareValue);
	if (operator === "_neq") dbQuery[logical].whereNot(selectionRaw, compareValue);
	if (operator === "_ieq") dbQuery[logical].whereRaw(`LOWER(??) = ?`, [selectionRaw, `${compareValue.toLowerCase()}`]);
	if (operator === "_nieq") dbQuery[logical].whereRaw(`LOWER(??) <> ?`, [selectionRaw, `${compareValue.toLowerCase()}`]);
	if (operator === "_contains") dbQuery[logical].where(selectionRaw, "like", `%${compareValue}%`);
	if (operator === "_ncontains") dbQuery[logical].whereNot(selectionRaw, "like", `%${compareValue}%`);
	if (operator === "_icontains") dbQuery[logical].whereRaw(`LOWER(??) LIKE ?`, [selectionRaw, `%${compareValue.toLowerCase()}%`]);
	if (operator === "_nicontains") dbQuery[logical].whereRaw(`LOWER(??) NOT LIKE ?`, [selectionRaw, `%${compareValue.toLowerCase()}%`]);
	if (operator === "_starts_with") dbQuery[logical].where(key, "like", `${compareValue}%`);
	if (operator === "_nstarts_with") dbQuery[logical].whereNot(key, "like", `${compareValue}%`);
	if (operator === "_istarts_with") dbQuery[logical].whereRaw(`LOWER(??) LIKE ?`, [selectionRaw, `${compareValue.toLowerCase()}%`]);
	if (operator === "_nistarts_with") dbQuery[logical].whereRaw(`LOWER(??) NOT LIKE ?`, [selectionRaw, `${compareValue.toLowerCase()}%`]);
	if (operator === "_ends_with") dbQuery[logical].where(key, "like", `%${compareValue}`);
	if (operator === "_nends_with") dbQuery[logical].whereNot(key, "like", `%${compareValue}`);
	if (operator === "_iends_with") dbQuery[logical].whereRaw(`LOWER(??) LIKE ?`, [selectionRaw, `%${compareValue.toLowerCase()}`]);
	if (operator === "_niends_with") dbQuery[logical].whereRaw(`LOWER(??) NOT LIKE ?`, [selectionRaw, `%${compareValue.toLowerCase()}`]);
	if (operator === "_gt") dbQuery[logical].where(selectionRaw, ">", compareValue);
	if (operator === "_gte") dbQuery[logical].where(selectionRaw, ">=", compareValue);
	if (operator === "_lt") dbQuery[logical].where(selectionRaw, "<", compareValue);
	if (operator === "_lte") dbQuery[logical].where(selectionRaw, "<=", compareValue);
	if (operator === "_in") {
		let value = compareValue;
		if (typeof value === "string") value = value.split(",");
		dbQuery[logical].whereIn(selectionRaw, value);
	}
	if (operator === "_nin") {
		let value = compareValue;
		if (typeof value === "string") value = value.split(",");
		dbQuery[logical].whereNotIn(selectionRaw, value);
	}
	if (operator === "_between") {
		let value = compareValue;
		if (typeof value === "string") value = value.split(",");
		if (value.length !== 2) return;
		dbQuery[logical].whereBetween(selectionRaw, value);
	}
	if (operator === "_nbetween") {
		let value = compareValue;
		if (typeof value === "string") value = value.split(",");
		if (value.length !== 2) return;
		dbQuery[logical].whereNotBetween(selectionRaw, value);
	}
	if (operator == "_intersects") dbQuery[logical].whereRaw(helpers.st.intersects(key, compareValue));
	if (operator == "_nintersects") dbQuery[logical].whereRaw(helpers.st.nintersects(key, compareValue));
	if (operator == "_intersects_bbox") dbQuery[logical].whereRaw(helpers.st.intersects_bbox(key, compareValue));
	if (operator == "_nintersects_bbox") dbQuery[logical].whereRaw(helpers.st.nintersects_bbox(key, compareValue));
}

//#endregion
export { applyOperator };