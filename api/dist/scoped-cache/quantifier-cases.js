import { joinFilterWithCases } from "../database/run-ast/lib/apply-query/join-filter-with-cases.js";
import { findRelatedCollection } from "../permissions/modules/process-ast/utils/find-related-collection.js";
import { isFilterNode } from "../utils/filter-shape.js";
import { parseFilterKey } from "../utils/parse-filter-key.js";
import { getCases } from "../permissions/modules/process-ast/lib/get-cases.js";

//#region src/scoped-cache/quantifier-cases.ts
/**
* The read as the database answers it: `applyFilter` adds the read rules of the
* related rows to every `_some`/`_none` subquery, which leaves no trace in the
* AST. A write crossing one of those rules changes the response all the same, so
* the plan reads a copy carrying them; the query itself still runs the original.
*/
function scopedCacheAstWithQuantifierCases(schema, ast, permissions) {
	if (permissions.length === 0) return ast;
	const quantifyFilter = (collection, filter) => {
		return Object.fromEntries(Object.entries(filter).map(([key, value]) => {
			if ((key === "_and" || key === "_or") && Array.isArray(value)) return [key, value.map((branch) => quantifyFilter(collection, branch))];
			if ((key === "_some" || key === "_none") && isFilterNode(value)) {
				const { cases } = getCases(collection, permissions, []);
				return [key, joinFilterWithCases(quantifyFilter(collection, value), cases.map((ruleCase) => quantifyFilter(collection, ruleCase)))];
			}
			if (key.startsWith("_") || !isFilterNode(value)) return [key, value];
			const [pathField, pathScope] = key.split(":");
			const relatedCollection = pathScope ?? findRelatedCollection(collection, parseFilterKey(pathField).fieldName, schema);
			return [key, relatedCollection === null ? value : quantifyFilter(relatedCollection, value)];
		}));
	};
	const quantifyNode = (collection, query, cases) => {
		return {
			query: query.filter ? {
				...query,
				filter: quantifyFilter(collection, query.filter)
			} : query,
			cases: cases.map((ruleCase) => quantifyFilter(collection, ruleCase))
		};
	};
	const quantifyChildren = (children) => {
		return children.map((child) => {
			if (child.type === "field") return child;
			if (child.type === "functionField") return {
				...child,
				...quantifyNode(child.relatedCollection, child.query, child.cases)
			};
			if (child.type === "a2o") {
				const quantifiedChild = {
					...child,
					query: { ...child.query },
					cases: { ...child.cases },
					children: { ...child.children }
				};
				for (const name of child.names) {
					const { query, cases } = quantifyNode(name, child.query[name] ?? {}, child.cases[name] ?? []);
					quantifiedChild.query[name] = query;
					quantifiedChild.cases[name] = cases;
					quantifiedChild.children[name] = quantifyChildren(child.children[name] ?? []);
				}
				return quantifiedChild;
			}
			return {
				...child,
				...quantifyNode(child.name, child.query, child.cases),
				children: quantifyChildren(child.children)
			};
		});
	};
	return {
		...ast,
		...quantifyNode(ast.name, ast.query, ast.cases),
		children: quantifyChildren(ast.children)
	};
}

//#endregion
export { scopedCacheAstWithQuantifierCases };