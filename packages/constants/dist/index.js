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
	Action$1["LOGOUT"] = "logout";
	Action$1["RUN"] = "run";
	Action$1["INSTALL"] = "install";
	return Action$1;
}({});

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
	"translations"
];
const GENERATE_SPECIAL = [
	"uuid",
	"date-created",
	"date-updated",
	"role-created",
	"role-updated",
	"user-created",
	"user-updated"
];
const TRANSLATIONS_STRIPPED_ON_CLONE_SPECIALS = [
	...GENERATE_SPECIAL,
	"no-data",
	"cast-timestamp"
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
	"count",
	"json"
];
const SEARCHABLE_TYPES = [
	"text",
	"string",
	"integer",
	"bigInteger",
	"float",
	"decimal",
	"uuid"
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
const REGEX_BETWEEN_PARENS = /\(([^()]+)\)/;
const REGEX_DB_SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

//#endregion
export { API_EXTENSION_TYPES, API_INJECT, APP_EXTENSION_TYPES, APP_OR_HYBRID_EXTENSION_PACKAGE_TYPES, APP_OR_HYBRID_EXTENSION_TYPES, Action, BUNDLE_EXTENSION_TYPES, DEFAULT_CHUNK_SIZE, DEFAULT_NUMERIC_PRECISION, DEFAULT_NUMERIC_SCALE, EXTENSIONS_INJECT, EXTENSION_TYPES, FUNCTIONS, GENERATE_SPECIAL, GEOMETRY_FORMATS, GEOMETRY_TYPES, HYBRID_EXTENSION_TYPES, JAVASCRIPT_FILE_EXTS, KNEX_TYPES, LOCAL_TYPES, MAX_SAFE_INT32, MAX_SAFE_INT64, MIN_SAFE_INT32, MIN_SAFE_INT64, NESTED_EXTENSION_TYPES, NUMERIC_TYPES, PERMISSION_ACTIONS, REGEX_BETWEEN_PARENS, REGEX_DB_SAFE_IDENTIFIER, RELATIONAL_TYPES, SDK_INJECT, SEARCHABLE_TYPES, STORES_INJECT, TRANSLATIONS_STRIPPED_ON_CLONE_SPECIALS, TYPES };