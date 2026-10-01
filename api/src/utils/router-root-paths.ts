import type { Router } from 'express';

/**
 * The root paths a router answers on, as an edge could allow them: the first
 * segment of each route and mount, when that segment is literal. A router
 * mounted at `/` is walked instead, since it is its routes that name the paths.
 *
 * A route whose first segment is a parameter or a pattern (`/:pk`, `*`) answers
 * on any path, which no list of literal prefixes stands for: it is returned
 * apart, under `dynamic`, so the caller can say so rather than silently block it.
 */
export function routerRootPaths(router: Router): {
	paths: string[];
	dynamic: string[];
} {
	const paths = new Set<string>();
	const dynamic = new Set<string>();

	for (const layer of router.stack) {
		if (layer.route) {
			for (const path of [layer.route.path].flat()) {
				sort(String(path), paths, dynamic);
			}

			continue;
		}

		const mount = mountOf(layer);

		if (mount === null) {
			dynamic.add(layer.regexp.source);
		}
		else if (mount !== '/') {
			sort(mount, paths, dynamic);
		}
		else if (isRouter(layer.handle)) {
			const nested = routerRootPaths(layer.handle);

			nested.paths.forEach((path) => paths.add(path));
			nested.dynamic.forEach((path) => dynamic.add(path));
		}
	}

	return { paths: [...paths], dynamic: [...dynamic] };
}

/** A literal first segment goes to `paths`, any other to `dynamic`. */
function sort(path: string, paths: Set<string>, dynamic: Set<string>): void {
	if (/^\/[\w.~-]*(?=\/|$)/.test(path)) {
		paths.add(rootOf(path));
	}
	else {
		dynamic.add(path);
	}
}

/**
 * Express 4 keeps no path on a `use` layer, only the regexp built from it:
 * `/^\/name\/?(?=\/|$)/i` for a literal mount, `fast_slash` for `/`. Null when
 * the mount carries a parameter, which the edge cannot allow by prefix.
 */
function mountOf(layer: Router['stack'][number]): string | null {
	const regexp = layer.regexp as RegExp & { fast_slash?: boolean };

	if (regexp.fast_slash === true) {
		return '/';
	}

	const literal = /^\^((?:\\\/[^/()]+)+)\\\/\?\(\?=\\\/\|\$\)$/.exec(regexp.source);

	if (literal === null || layer.keys.length > 0) {
		return null;
	}

	return literal[1]!.replaceAll('\\', '');
}

function isRouter(handle: unknown): handle is Router {
	return typeof handle === 'function' && Array.isArray((handle as Router).stack);
}

/** `/files/tus` → `/files`; `/` stays `/`. */
export function rootOf(path: string): string {
	const [, first = ''] = path.split('/');

	return `/${first}`;
}
