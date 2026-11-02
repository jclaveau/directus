import { systemMcpEnabled } from "./system-mcp/lib/config.js";
import { rootOf } from "./utils/router-root-paths.js";
import { useEnv } from "@directus/env";
import { toBoolean } from "@directus/utils";

//#region src/core-mounts.ts
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
const CORE_MOUNTS = [
	{ path: "/auth" },
	{ path: "/graphql" },
	{ path: "/activity" },
	{ path: "/access" },
	{ path: "/assets" },
	{ path: "/collections" },
	{ path: "/comments" },
	{ path: "/dashboards" },
	{ path: "/extensions" },
	{ path: "/fields" },
	{
		path: "/files/tus",
		when: () => useEnv()["TUS_ENABLED"] === true
	},
	{ path: "/files" },
	{ path: "/flows" },
	{ path: "/folders" },
	{ path: "/items" },
	{
		path: "/system-mcp",
		when: systemMcpEnabled
	},
	{
		path: "/metrics",
		when: () => useEnv()["METRICS_ENABLED"] === true
	},
	{ path: "/notifications" },
	{ path: "/operations" },
	{ path: "/panels" },
	{ path: "/permissions" },
	{ path: "/policies" },
	{ path: "/presets" },
	{ path: "/translations" },
	{ path: "/relations" },
	{ path: "/revisions" },
	{ path: "/roles" },
	{ path: "/schema" },
	{ path: "/server" },
	{ path: "/settings" },
	{ path: "/shares" },
	{ path: "/users" },
	{ path: "/utils" },
	{ path: "/versions" },
	{ path: "/webhooks" }
];
/**
* The handlers `createApp` puts on a root path itself, outside any router. The
* gate of each mirrors the one `app.ts` reads before registering it.
*/
const CORE_ROOT_HANDLERS = [
	{ path: "/" },
	{ path: "/robots.txt" },
	{
		path: "/admin",
		when: () => Boolean(useEnv()["SERVE_APP"])
	}
];
/** The router mounts this deployment's environment turns on, in mount order. */
function coreMountPaths() {
	return CORE_MOUNTS.filter((mount) => mount.when?.() ?? true).map((mount) => mount.path);
}
const WEBSOCKET_CONTROLLERS = [
	"REST",
	"GRAPHQL",
	"LOGS"
];
/**
* The websocket controllers hang off the http server rather than the app, each
* on the path its env names, gated as `createServer` and `startWebSocketHandlers`
* gate them. An upgrade request still passes the edge first.
*/
function websocketRootPaths() {
	const env = useEnv();
	if (toBoolean(env["WEBSOCKETS_ENABLED"]) === false) return [];
	return WEBSOCKET_CONTROLLERS.filter((controller) => toBoolean(env[`WEBSOCKETS_${controller}_ENABLED`])).map((controller) => rootOf(String(env[`WEBSOCKETS_${controller}_PATH`])));
}
/**
* Every root path the core API answers on in this environment: the root
* handlers, the websocket controllers and the first segment of each mount that
* is on, once each, in the order they are registered.
*/
function coreRootPaths() {
	const paths = /* @__PURE__ */ new Set();
	for (const handler of CORE_ROOT_HANDLERS) if (handler.when?.() ?? true) paths.add(handler.path);
	for (const path of websocketRootPaths()) paths.add(path);
	for (const path of coreMountPaths()) paths.add(rootOf(path));
	return [...paths];
}

//#endregion
export { CORE_MOUNTS, coreMountPaths, coreRootPaths };