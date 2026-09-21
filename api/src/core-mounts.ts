import { useEnv } from '@directus/env';
import { systemMcpEnabled } from './system-mcp/lib/config.js';
import { rootOf } from './utils/router-root-paths.js';

type CoreMount = {
	readonly path: string;
	/** Left out when the mount is unconditional. */
	readonly when?: () => boolean;
};

/**
 * The paths `createApp` mounts a core router on, in mount order.
 *
 * Kept as data rather than as the `app.use` lines themselves so that what the
 * API answers can be read without building it: `edge allow-list` turns this list
 * into the paths an edge in front of the deployment lets through, and a path
 * mounted here but missing from that list would be blocked before it reached
 * the API. The routers stay in `app.ts`, keyed by these paths, so a mount added
 * on one side and not the other fails to compile.
 *
 * Order matters once: `/files/tus` has to be mounted before `/files` answers it.
 */
export const CORE_MOUNTS = [
	{ path: '/auth' },
	{ path: '/graphql' },
	{ path: '/activity' },
	{ path: '/access' },
	{ path: '/assets' },
	{ path: '/collections' },
	{ path: '/comments' },
	{ path: '/dashboards' },
	{ path: '/extensions' },
	{ path: '/fields' },
	{ path: '/files/tus', when: () => useEnv()['TUS_ENABLED'] === true },
	{ path: '/files' },
	{ path: '/flows' },
	{ path: '/folders' },
	{ path: '/items' },
	// Not `/mcp`: upstream Directus serves its own MCP there, over the content
	// API. Its own top-level path rather than under `/admin`, which the Data
	// Studio's `/admin/*` catch-all would answer before any router here.
	{ path: '/system-mcp', when: systemMcpEnabled },
	{ path: '/metrics', when: () => useEnv()['METRICS_ENABLED'] === true },
	{ path: '/notifications' },
	{ path: '/operations' },
	{ path: '/panels' },
	{ path: '/permissions' },
	{ path: '/policies' },
	{ path: '/presets' },
	{ path: '/translations' },
	{ path: '/relations' },
	{ path: '/revisions' },
	{ path: '/roles' },
	{ path: '/schema' },
	{ path: '/server' },
	{ path: '/settings' },
	{ path: '/shares' },
	{ path: '/users' },
	{ path: '/utils' },
	{ path: '/versions' },
	{ path: '/webhooks' },
] as const satisfies readonly CoreMount[];

export type CoreMountPath = (typeof CORE_MOUNTS)[number]['path'];

/**
 * The handlers `createApp` puts on a root path itself, outside any router. The
 * gate of each mirrors the one `app.ts` reads before registering it.
 */
const CORE_ROOT_HANDLERS: readonly CoreMount[] = [
	{ path: '/' },
	{ path: '/robots.txt' },
	{ path: '/admin', when: () => Boolean(useEnv()['SERVE_APP']) },
];

/** The router mounts this deployment's environment turns on, in mount order. */
export function coreMountPaths(): CoreMountPath[] {
	return CORE_MOUNTS
		.filter((mount: CoreMount) => mount.when?.() ?? true)
		.map((mount) => mount.path);
}

/**
 * Every root path the core API answers on in this environment: the root
 * handlers and the first segment of each mount that is on, once each, in the
 * order they are registered.
 */
export function coreRootPaths(): string[] {
	const paths = new Set<string>();

	for (const handler of CORE_ROOT_HANDLERS) {
		if (handler.when?.() ?? true) {
			paths.add(handler.path);
		}
	}

	for (const path of coreMountPaths()) {
		paths.add(rootOf(path));
	}

	return [...paths];
}
