import { isEqual, uniq, uniqWith } from "../../../../utils/lodash-es-used.js";
import { getUnaliasedFieldKey } from "../../../utils/get-unaliased-field-key.js";
import { getCases } from "./get-cases.js";
import { getAggregateFieldCases } from "./aggregate-field-cases.js";

//#region src/permissions/modules/process-ast/lib/inject-cases.ts
/**
* Mutates passed AST
*
* @param ast - Read query AST
* @param permissions - Expected to be filtered down for the policies and action already
*/
function injectCases(ast, permissions) {
	ast.cases = processChildren(ast.name, ast.children, permissions);
	injectAggregateCases(ast, ast.name, permissions);
}
function injectAggregateCases(node, collection, permissions) {
	const aggregateCases = aggregateCasesOf(collection, node.query, permissions, node.cases);
	if (aggregateCases.length > 0) node.aggregateCases = aggregateCases;
}
function aggregateCasesOf(collection, query, permissions, cases) {
	return uniqWith(uniq(Object.values(query?.aggregate ?? {}).flat()).filter((field) => field !== "*").flatMap((field) => {
		return getAggregateFieldCases(collection, field, {
			cases,
			permissions
		});
	}), isEqual);
}
function processChildren(collection, children, permissions) {
	const { cases, caseMap, allowedFields } = getCases(collection, permissions, uniq(children.map(getUnaliasedFieldKey)));
	for (const child of children) {
		const fieldKey = getUnaliasedFieldKey(child);
		const globalWhenCase = caseMap["*"];
		const fieldWhenCase = caseMap[fieldKey];
		if (!globalWhenCase && !fieldWhenCase) throw new Error(`Cannot extract access permissions for field "${fieldKey}" in collection "${collection}"`);
		if (!allowedFields.has("*") && !allowedFields.has(fieldKey)) child.whenCase = [...globalWhenCase ?? [], ...fieldWhenCase ?? []];
		if (child.type === "m2o") {
			child.cases = processChildren(child.relation.related_collection, child.children, permissions);
			injectAggregateCases(child, child.relation.related_collection, permissions);
		}
		if (child.type === "o2m") {
			child.cases = processChildren(child.relation.collection, child.children, permissions);
			injectAggregateCases(child, child.relation.collection, permissions);
		}
		if (child.type === "a2o") for (const collection$1 of child.names) {
			child.cases[collection$1] = processChildren(collection$1, child.children[collection$1] ?? [], permissions);
			const aggregateCases = aggregateCasesOf(collection$1, child.query[collection$1], permissions, child.cases[collection$1]);
			if (aggregateCases.length > 0) child.aggregateCases = {
				...child.aggregateCases,
				[collection$1]: aggregateCases
			};
		}
		if (child.type === "functionField") {
			const { cases: cases$1 } = getCases(child.relatedCollection, permissions, []);
			child.cases = cases$1;
		}
	}
	return cases;
}

//#endregion
export { injectCases };