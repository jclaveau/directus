//#region src/permissions/modules/process-ast/utils/flatten-filter.ts
function flattenFilter(paths, filter) {
	if (!filter) return;
	const stack = [{
		current: filter,
		path: []
	}];
	while (stack.length > 0) {
		const { current, path } = stack.pop();
		if (typeof current === "object" && current !== null) {
			const isArray = Array.isArray(current);
			for (const key in current) if (!key.startsWith("_") || key === "_and" || key === "_or" || key === "_some" || key === "_none") stack.push({
				current: current[key],
				path: isArray ? path : [...path, key]
			});
			else {
				const parts = path.filter((part) => part.startsWith("_") === false);
				if (parts.length > 0) paths.push(parts);
			}
		} else {
			const parts = path.filter((part) => part.startsWith("_") === false);
			if (parts.length > 0) paths.push(parts);
		}
	}
}

//#endregion
export { flattenFilter };