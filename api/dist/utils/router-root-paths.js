//#region src/utils/router-root-paths.ts
/**
* The root paths a router answers on, as an edge could allow them: the first
* segment of each route and mount, when that segment is literal. A router
* mounted at `/` is walked instead, since it is its routes that name the paths.
*
* A route whose first segment is a parameter or a pattern (`/:pk`, `*`) answers
* on any path, which no list of literal prefixes stands for: it is returned
* apart, under `dynamic`, so the caller can say so rather than silently block it.
*/
function routerRootPaths(router) {
	const paths = /* @__PURE__ */ new Set();
	const dynamic = /* @__PURE__ */ new Set();
	for (const layer of router.stack) {
		if (layer.route) {
			for (const path of [layer.route.path].flat()) sort(String(path), paths, dynamic);
			continue;
		}
		const mount = mountOf(layer);
		if (mount === null) dynamic.add(layer.regexp.source);
		else if (mount !== "/") sort(mount, paths, dynamic);
		else if (isRouter(layer.handle)) {
			const nested = routerRootPaths(layer.handle);
			nested.paths.forEach((path) => paths.add(path));
			nested.dynamic.forEach((path) => dynamic.add(path));
		}
	}
	return {
		paths: [...paths],
		dynamic: [...dynamic]
	};
}
/** A literal first segment goes to `paths`, any other to `dynamic`. */
function sort(path, paths, dynamic) {
	if (/^\/[\w.~-]*(?=\/|$)/.test(path)) paths.add(rootOf(path));
	else dynamic.add(path);
}
/**
* Express 4 keeps no path on a `use` layer, only the regexp built from it:
* `/^\/name\/?(?=\/|$)/i` for a literal mount, `fast_slash` for `/`. Null when
* the mount carries a parameter, which the edge cannot allow by prefix.
*/
function mountOf(layer) {
	const regexp = layer.regexp;
	if (regexp.fast_slash === true) return "/";
	const literal = /^\^((?:\\\/[^/()]+)+)\\\/\?\(\?=\\\/\|\$\)$/.exec(regexp.source);
	if (literal === null || layer.keys.length > 0) return null;
	return literal[1].replaceAll("\\", "");
}
function isRouter(handle) {
	return typeof handle === "function" && Array.isArray(handle.stack);
}
/** `/files/tus` → `/files`; `/` stays `/`. */
function rootOf(path) {
	const [, first = ""] = path.split("/");
	return `/${first}`;
}

//#endregion
export { rootOf, routerRootPaths };