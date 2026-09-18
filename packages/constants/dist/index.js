//#region src/activity.ts
let Action = /* @__PURE__ */ function(Action$1) {
	Action$1["CREATE"] = "create";
	Action$1["UPDATE"] = "update";
	Action$1["DELETE"] = "delete";
	Action$1["REVERT"] = "revert";
	Action$1["VERSION_SAVE"] = "version_save";
	Action$1["COMMENT"] = "comment";
	Action$1["UPLOAD"] = "upload";
	Action$1["LOGIN"] = "login";
	Action$1["RUN"] = "run";
	Action$1["INSTALL"] = "install";
	return Action$1;
}({});

//#endregion
//#region src/autoscale.ts
/**
* The most workers the autoscaler will scale a pool to, whatever it is asked
* for.
*
* A blunt guard against a typed zero, not a capacity calculation: the pool that
* can actually be afforded comes from the cgroup limit divided by measured
* per-worker RSS. Until then a `maxWorkers` of 10000 has to fail as a clamp and
* a log line rather than as a dead container.
*/
const MAX_SUPPORTED_WORKERS = 64;
/**
* How many samples the `legacy` strategy averages a worker over, which is the
* module's own number and so the depth of the ring both strategies read: no
* window can be asked for past it.
*/
const LEGACY_SAMPLE_WINDOW = 30;
/**
* The longest any of the pacing fields may be asked for, in seconds.
*
* A day, which no cooldown is: past it the number is a duration typed in
* milliseconds, and a cooldown of `300000` freezes the pool for three and a
* half days without ever looking wrong in a list of numbers.
*/
const MAX_PACING_SECONDS = 86400;
/**
* What each field of the autoscale configuration accepts.
*
* Here rather than beside any one of its readers because three of them need
* the same numbers and disagreeing is the failure: the write refuses what sits
* outside these, the loop clamps to them, and the panel's inputs offer them.
*/
const AUTOSCALE_BOUNDS = {
	sampleWindow: {
		low: 1,
		high: LEGACY_SAMPLE_WINDOW,
		unit: "samples"
	},
	scaleCpuThreshold: {
		low: 1,
		high: 100,
		unit: "%"
	},
	releaseCpuThreshold: {
		low: 0,
		high: 99,
		unit: "%"
	},
	minWorkers: {
		low: 1,
		high: MAX_SUPPORTED_WORKERS,
		unit: "workers"
	},
	maxWorkers: {
		low: 1,
		high: MAX_SUPPORTED_WORKERS,
		unit: "workers"
	},
	prewarmWorkers: {
		low: 0,
		high: MAX_SUPPORTED_WORKERS,
		unit: "workers"
	},
	minSecondsToScaleUp: {
		low: 0,
		high: MAX_PACING_SECONDS,
		unit: "seconds"
	},
	minSecondsToScaleDown: {
		low: 0,
		high: MAX_PACING_SECONDS,
		unit: "seconds"
	},
	warmupSeconds: {
		low: 0,
		high: MAX_PACING_SECONDS,
		unit: "seconds"
	}
};
/**
* What each pm2 option a rolling restart can carry accepts.
*
* Refused outside these rather than clamped: nothing downstream corrects them,
* so a value out of range would be handed to the supervisor as typed — a
* `kill_timeout` of zero drops every request a released worker was serving.
*/
const SUPERVISOR_BOUNDS = {
	listenTimeout: {
		low: 1e3,
		high: 6e5,
		unit: "ms"
	},
	killTimeout: {
		low: 100,
		high: 6e5,
		unit: "ms"
	},
	minUptime: {
		low: 100,
		high: 6e5,
		unit: "ms"
	},
	restartDelay: {
		low: 0,
		high: 6e5,
		unit: "ms"
	},
	maxRestarts: {
		low: 0,
		high: 1e3,
		unit: ""
	},
	maxMemoryRestartMegabytes: {
		low: 64,
		high: 65536,
		unit: "MB"
	}
};

//#endregion
//#region src/extensions.ts
const APP_EXTENSION_TYPES = [
	"interface",
	"display",
	"layout",
	"module",
	"panel",
	"theme"
];
const API_EXTENSION_TYPES = ["hook", "endpoint"];
const HYBRID_EXTENSION_TYPES = ["operation"];
const BUNDLE_EXTENSION_TYPES = ["bundle"];
const EXTENSION_TYPES = [
	...APP_EXTENSION_TYPES,
	...API_EXTENSION_TYPES,
	...HYBRID_EXTENSION_TYPES,
	...BUNDLE_EXTENSION_TYPES
];
const NESTED_EXTENSION_TYPES = [
	...APP_EXTENSION_TYPES,
	...API_EXTENSION_TYPES,
	...HYBRID_EXTENSION_TYPES
];
const APP_OR_HYBRID_EXTENSION_TYPES = [...APP_EXTENSION_TYPES, ...HYBRID_EXTENSION_TYPES];
const APP_OR_HYBRID_EXTENSION_PACKAGE_TYPES = [...APP_OR_HYBRID_EXTENSION_TYPES, ...BUNDLE_EXTENSION_TYPES];

//#endregion
//#region src/fields.ts
const KNEX_TYPES = [
	"bigInteger",
	"boolean",
	"date",
	"dateTime",
	"decimal",
	"float",
	"integer",
	"json",
	"string",
	"text",
	"time",
	"timestamp",
	"binary",
	"uuid"
];
const TYPES = [
	...KNEX_TYPES,
	"alias",
	"hash",
	"csv",
	"geometry",
	"geometry.Point",
	"geometry.LineString",
	"geometry.Polygon",
	"geometry.MultiPoint",
	"geometry.MultiLineString",
	"geometry.MultiPolygon",
	"unknown"
];
const NUMERIC_TYPES = [
	"bigInteger",
	"decimal",
	"float",
	"integer"
];
const GEOMETRY_TYPES = [
	"Point",
	"LineString",
	"Polygon",
	"MultiPoint",
	"MultiLineString",
	"MultiPolygon"
];
const GEOMETRY_FORMATS = [
	"native",
	"geojson",
	"wkt",
	"lnglat"
];
const LOCAL_TYPES = [
	"standard",
	"file",
	"files",
	"m2o",
	"o2m",
	"m2m",
	"m2a",
	"presentation",
	"translations",
	"group"
];
const RELATIONAL_TYPES = [
	"file",
	"files",
	"m2o",
	"o2m",
	"m2m",
	"m2a",
	"presentation",
	"translations",
	"group"
];
const FUNCTIONS = [
	"year",
	"month",
	"week",
	"day",
	"weekday",
	"hour",
	"minute",
	"second",
	"count"
];

//#endregion
//#region src/files.ts
const JAVASCRIPT_FILE_EXTS = [
	"js",
	"mjs",
	"cjs"
];
const DEFAULT_CHUNK_SIZE = 8388608;

//#endregion
//#region src/injection.ts
const STORES_INJECT = "stores";
const API_INJECT = "api";
const SDK_INJECT = "sdk";
const EXTENSIONS_INJECT = "extensions";

//#endregion
//#region src/items.ts
/**
* Keys of a nested relational mutation input (the `Alterations` type in `@directus/types`):
* `create` new children, `update` existing children by primary key, `delete` children by primary key.
*/
const ALTERATIONS_KEYS = [
	"create",
	"update",
	"delete"
];

//#endregion
//#region src/number.ts
const DEFAULT_NUMERIC_PRECISION = 10;
const DEFAULT_NUMERIC_SCALE = 5;
const MAX_SAFE_INT64 = 2n ** 63n - 1n;
const MIN_SAFE_INT64 = (-2n) ** 63n;
const MAX_SAFE_INT32 = 2 ** 31 - 1;
const MIN_SAFE_INT32 = (-2) ** 31;

//#endregion
//#region src/permissions.ts
const PERMISSION_ACTIONS = [
	"create",
	"read",
	"update",
	"delete",
	"share"
];

//#endregion
//#region src/regex.ts
const REGEX_BETWEEN_PARENS = /\(([^)]+)\)/;

//#endregion
export { ALTERATIONS_KEYS, API_EXTENSION_TYPES, API_INJECT, APP_EXTENSION_TYPES, APP_OR_HYBRID_EXTENSION_PACKAGE_TYPES, APP_OR_HYBRID_EXTENSION_TYPES, AUTOSCALE_BOUNDS, Action, BUNDLE_EXTENSION_TYPES, DEFAULT_CHUNK_SIZE, DEFAULT_NUMERIC_PRECISION, DEFAULT_NUMERIC_SCALE, EXTENSIONS_INJECT, EXTENSION_TYPES, FUNCTIONS, GEOMETRY_FORMATS, GEOMETRY_TYPES, HYBRID_EXTENSION_TYPES, JAVASCRIPT_FILE_EXTS, KNEX_TYPES, LEGACY_SAMPLE_WINDOW, LOCAL_TYPES, MAX_PACING_SECONDS, MAX_SAFE_INT32, MAX_SAFE_INT64, MAX_SUPPORTED_WORKERS, MIN_SAFE_INT32, MIN_SAFE_INT64, NESTED_EXTENSION_TYPES, NUMERIC_TYPES, PERMISSION_ACTIONS, REGEX_BETWEEN_PARENS, RELATIONAL_TYPES, SDK_INJECT, STORES_INJECT, SUPERVISOR_BOUNDS, TYPES };