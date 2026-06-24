//#region src/utils/split-field-path.ts
/**
* Splits a field path on dots that are outside parentheses.
*
* A plain `.split('.')` breaks when a path segment contains a function call
* whose arguments include dots (e.g. `category_id.json(metadata, settings.theme)`).
* This helper only splits on dots at paren-depth 0.
*
* @example
* splitFieldPath('a.b.c')                              // ['a', 'b', 'c']
* splitFieldPath('category_id.json(metadata, color)')  // ['category_id', 'json(metadata, color)']
* splitFieldPath('a.json(meta, x.y.z)')                // ['a', 'json(meta, x.y.z)']
*/
function splitFieldPath(path) {
	const parts = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < path.length; i++) if (path[i] === "(") depth++;
	else if (path[i] === ")") depth--;
	else if (path[i] === "." && depth === 0) {
		parts.push(path.slice(start, i));
		start = i + 1;
	}
	parts.push(path.slice(start));
	return parts;
}

//#endregion
export { splitFieldPath };