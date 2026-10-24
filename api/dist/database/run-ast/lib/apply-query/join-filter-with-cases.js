//#region src/database/run-ast/lib/apply-query/join-filter-with-cases.ts
function joinFilterWithCases(filter, cases) {
	if (cases.length > 0 && !filter) return { _or: cases };
	else if (filter && cases.length === 0) return filter ?? null;
	else if (filter && cases.length > 0) return { _and: [filter, { _or: cases }] };
	return null;
}

//#endregion
export { joinFilterWithCases };