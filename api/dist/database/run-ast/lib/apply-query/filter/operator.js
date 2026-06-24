import { getOperation } from "../get-operation.js";
import { parseJsonPath } from "../../../../helpers/fn/json/parse-function.js";
import { getColumn } from "../../../utils/get-column.js";
import { getFunctions, getHelpers } from "../../../../helpers/index.js";
import { InvalidQueryError } from "@directus/errors";
import { getOutputTypeForFunction } from "@directus/utils";

//#region src/database/run-ast/lib/apply-query/filter/operator.ts
function castToNumber(value) {
	if (Array.isArray(value)) return value.map((val) => {
		const num$1 = Number(val);
		if (Number.isNaN(num$1)) throw new InvalidQueryError({ reason: `Invalid numeric value` });
		return num$1;
	});
	const num = Number(value);
	if (Number.isNaN(num)) throw new InvalidQueryError({ reason: `Invalid numeric value` });
	return num;
}
/**
* Splits "table.column" into ["table", "column"], respecting dots inside parentheses.
* Handles keys like "table.json(col,path.with.dots)" correctly.
*/
function splitTableColumn(key) {
	let depth = 0;
	for (let i = 0; i < key.length; i++) if (key[i] === "(") depth++;
	else if (key[i] === ")") depth--;
	else if (key[i] === "." && depth === 0) return [key.substring(0, i), key.substring(i + 1)];
	return ["", key];
}
function applyOperator(knex, dbQuery, schema, key, operator, compareValue, logical = "and", originalCollectionName) {
	const helpers = getHelpers(knex);
	const [table, column] = splitTableColumn(key);
	if (operator === "_json") {
		if (!Object.entries(compareValue).length) return;
		const applyJsonConditions = (group, filterObj, innerLogical) => {
			for (const [jsonPath, innerFilter] of Object.entries(filterObj)) {
				if (jsonPath === "_or" || jsonPath === "_and") {
					const subLogical = jsonPath === "_or" ? "or" : "and";
					group[innerLogical].where((subGroup) => {
						for (const subFilter of innerFilter) applyJsonConditions(subGroup, subFilter, subLogical);
					});
					continue;
				}
				const normalizedPath = parseJsonPath(jsonPath);
				const innerValue = innerFilter[Object.keys(innerFilter)[0]];
				const castNumeric = typeof innerValue === "number" || Array.isArray(innerValue) && innerValue.length > 0 && typeof innerValue[0] === "number";
				const jsonExtractionRaw = getFunctions(knex, schema).json(table, column, {
					type: "json",
					jsonPath: normalizedPath,
					originalCollectionName,
					relationalCountOptions: void 0,
					jsonReturnType: castNumeric ? "numeric" : "text"
				});
				const innerOp = getOperation(Object.keys(innerFilter)[0], Object.values(innerFilter)[0]);
				if (!innerOp) continue;
				applyOperatorToRaw(group, helpers, jsonExtractionRaw, innerOp.operator, innerOp.value, innerLogical);
			}
		};
		dbQuery[logical].where((group) => {
			applyJsonConditions(group, compareValue, "and");
		});
		return;
	}
	const selectionRaw = getColumn(knex, table, column, false, schema, { originalCollectionName });
	if (operator === "_null" && compareValue !== false || operator === "_nnull" && compareValue === false || operator === "_eq" && compareValue === null) {
		dbQuery[logical].whereNull(selectionRaw);
		return;
	}
	if (operator === "_nnull" && compareValue !== false || operator === "_null" && compareValue === false || operator === "_neq" && compareValue === null) {
		dbQuery[logical].whereNotNull(selectionRaw);
		return;
	}
	if (operator === "_empty" && compareValue !== false || operator === "_nempty" && compareValue === false) {
		dbQuery[logical].andWhere((query) => {
			query.whereNull(selectionRaw).orWhere(selectionRaw, "=", "");
		});
		return;
	}
	if (operator === "_nempty" && compareValue !== false || operator === "_empty" && compareValue === false) {
		dbQuery[logical].andWhere((query) => {
			query.whereNotNull(selectionRaw).andWhere(selectionRaw, "!=", "");
		});
		return;
	}
	if (compareValue === void 0) return;
	if (Array.isArray(compareValue)) compareValue = compareValue.filter((val) => val !== void 0);
	if (column.includes("(") && column.includes(")")) {
		const functionName = column.split("(")[0];
		const type = getOutputTypeForFunction(functionName);
		if ([
			"integer",
			"float",
			"decimal"
		].includes(type)) compareValue = castToNumber(compareValue);
	}
	const [collection, field] = splitTableColumn(key);
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
		].includes(type)) compareValue = castToNumber(compareValue);
	}
	applyOperatorToRaw(dbQuery, helpers, selectionRaw, operator, compareValue, logical, key);
}
function applyOperatorToRaw(dbQuery, helpers, raw, operator, compareValue, logical, key) {
	if (operator === "_null" && compareValue !== false || operator === "_nnull" && compareValue === false || operator === "_eq" && compareValue === null) {
		dbQuery[logical].whereNull(raw);
		return;
	}
	if (operator === "_nnull" && compareValue !== false || operator === "_null" && compareValue === false || operator === "_neq" && compareValue === null) {
		dbQuery[logical].whereNotNull(raw);
		return;
	}
	if (operator === "_empty" && compareValue !== false || operator === "_nempty" && compareValue === false) {
		dbQuery[logical].andWhere((query) => {
			query.whereNull(raw).orWhere(raw, "=", "");
		});
		return;
	}
	if (operator === "_nempty" && compareValue !== false || operator === "_empty" && compareValue === false) {
		dbQuery[logical].andWhere((query) => {
			query.whereNotNull(raw).andWhere(raw, "!=", "");
		});
		return;
	}
	if (compareValue === void 0) return;
	if (Array.isArray(compareValue)) compareValue = compareValue.filter((val) => val !== void 0);
	if (operator === "_eq") dbQuery[logical].where(raw, "=", compareValue);
	if (operator === "_neq") dbQuery[logical].whereNot(raw, compareValue);
	if (operator === "_ieq") dbQuery[logical].whereRaw(`LOWER(??) = ?`, [raw, `${compareValue.toLowerCase()}`]);
	if (operator === "_nieq") dbQuery[logical].whereRaw(`LOWER(??) <> ?`, [raw, `${compareValue.toLowerCase()}`]);
	if (operator === "_contains") dbQuery[logical].where(raw, "like", `%${compareValue}%`);
	if (operator === "_ncontains") dbQuery[logical].whereNot(raw, "like", `%${compareValue}%`);
	if (operator === "_icontains") dbQuery[logical].whereRaw(`LOWER(??) LIKE ?`, [raw, `%${compareValue.toLowerCase()}%`]);
	if (operator === "_nicontains") dbQuery[logical].whereRaw(`LOWER(??) NOT LIKE ?`, [raw, `%${compareValue.toLowerCase()}%`]);
	if (operator === "_starts_with") dbQuery[logical].where(raw, "like", `${compareValue}%`);
	if (operator === "_nstarts_with") dbQuery[logical].whereNot(raw, "like", `${compareValue}%`);
	if (operator === "_istarts_with") dbQuery[logical].whereRaw(`LOWER(??) LIKE ?`, [raw, `${compareValue.toLowerCase()}%`]);
	if (operator === "_nistarts_with") dbQuery[logical].whereRaw(`LOWER(??) NOT LIKE ?`, [raw, `${compareValue.toLowerCase()}%`]);
	if (operator === "_ends_with") dbQuery[logical].where(raw, "like", `%${compareValue}`);
	if (operator === "_nends_with") dbQuery[logical].whereNot(raw, "like", `%${compareValue}`);
	if (operator === "_iends_with") dbQuery[logical].whereRaw(`LOWER(??) LIKE ?`, [raw, `%${compareValue.toLowerCase()}`]);
	if (operator === "_niends_with") dbQuery[logical].whereRaw(`LOWER(??) NOT LIKE ?`, [raw, `%${compareValue.toLowerCase()}`]);
	if (operator === "_gt") dbQuery[logical].where(raw, ">", compareValue);
	if (operator === "_gte") dbQuery[logical].where(raw, ">=", compareValue);
	if (operator === "_lt") dbQuery[logical].where(raw, "<", compareValue);
	if (operator === "_lte") dbQuery[logical].where(raw, "<=", compareValue);
	if (operator === "_in") {
		let value = compareValue;
		if (typeof value === "string") value = value.split(",");
		if (value.length === 0) dbQuery[logical].whereIn(raw, []);
		else {
			const placeholders = value.map(() => "?").join(", ");
			dbQuery[logical].whereRaw(`?? in (${placeholders})`, [raw, ...value]);
		}
	}
	if (operator === "_nin") {
		let value = compareValue;
		if (typeof value === "string") value = value.split(",");
		if (value.length === 0) dbQuery[logical].whereNotIn(raw, []);
		else {
			const placeholders = value.map(() => "?").join(", ");
			dbQuery[logical].whereRaw(`?? not in (${placeholders})`, [raw, ...value]);
		}
	}
	if (operator === "_between") {
		let value = compareValue;
		if (typeof value === "string") value = value.split(",");
		if (value.length !== 2) return;
		dbQuery[logical].whereBetween(raw, value);
	}
	if (operator === "_nbetween") {
		let value = compareValue;
		if (typeof value === "string") value = value.split(",");
		if (value.length !== 2) return;
		dbQuery[logical].whereNotBetween(raw, value);
	}
	if (operator == "_intersects") dbQuery[logical].whereRaw(helpers.st.intersects(key, compareValue));
	if (operator == "_nintersects") dbQuery[logical].whereRaw(helpers.st.nintersects(key, compareValue));
	if (operator == "_intersects_bbox") dbQuery[logical].whereRaw(helpers.st.intersects_bbox(key, compareValue));
	if (operator == "_nintersects_bbox") dbQuery[logical].whereRaw(helpers.st.nintersects_bbox(key, compareValue));
}

//#endregion
export { applyOperator };