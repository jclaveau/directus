//#region src/activity.d.ts
declare enum Action {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  REVERT = "revert",
  VERSION_SAVE = "version_save",
  COMMENT = "comment",
  UPLOAD = "upload",
  LOGIN = "login",
  RUN = "run",
  INSTALL = "install",
}
//#endregion
//#region src/autoscale.d.ts
/**
 * The most workers the autoscaler will scale a pool to, whatever it is asked
 * for.
 *
 * A blunt guard against a typed zero, not a capacity calculation: the pool that
 * can actually be afforded comes from the cgroup limit divided by measured
 * per-worker RSS. Until then a `maxWorkers` of 10000 has to fail as a clamp and
 * a log line rather than as a dead container.
 */
declare const MAX_SUPPORTED_WORKERS = 64;
/**
 * How many samples the `legacy` strategy averages a worker over, which is the
 * module's own number and so the depth of the ring both strategies read: no
 * window can be asked for past it.
 */
declare const LEGACY_SAMPLE_WINDOW = 30;
/**
 * The longest any of the pacing fields may be asked for, in seconds.
 *
 * A day, which no cooldown is: past it the number is a duration typed in
 * milliseconds, and a cooldown of `300000` freezes the pool for three and a
 * half days without ever looking wrong in a list of numbers.
 */
declare const MAX_PACING_SECONDS = 86400;
/** The range a numeric field accepts, and what the number counts. */
interface AutoscaleBound {
  low: number;
  high: number;
  /** What the number counts, so a message reads as the field does. */
  unit: string;
}
/**
 * What each field of the autoscale configuration accepts.
 *
 * Here rather than beside any one of its readers because three of them need
 * the same numbers and disagreeing is the failure: the write refuses what sits
 * outside these, the loop clamps to them, and the panel's inputs offer them.
 */
declare const AUTOSCALE_BOUNDS: {
  sampleWindow: {
    low: number;
    high: number;
    unit: string;
  };
  scaleCpuThreshold: {
    low: number;
    high: number;
    unit: string;
  };
  releaseCpuThreshold: {
    low: number;
    high: number;
    unit: string;
  };
  minWorkers: {
    low: number;
    high: number;
    unit: string;
  };
  maxWorkers: {
    low: number;
    high: number;
    unit: string;
  };
  prewarmWorkers: {
    low: number;
    high: number;
    unit: string;
  };
  minSecondsToScaleUp: {
    low: number;
    high: number;
    unit: string;
  };
  minSecondsToScaleDown: {
    low: number;
    high: number;
    unit: string;
  };
  warmupSeconds: {
    low: number;
    high: number;
    unit: string;
  };
};
/**
 * What each pm2 option a rolling restart can carry accepts.
 *
 * Refused outside these rather than clamped: nothing downstream corrects them,
 * so a value out of range would be handed to the supervisor as typed — a
 * `kill_timeout` of zero drops every request a released worker was serving.
 */
declare const SUPERVISOR_BOUNDS: {
  listenTimeout: {
    low: number;
    high: number;
    unit: string;
  };
  killTimeout: {
    low: number;
    high: number;
    unit: string;
  };
  minUptime: {
    low: number;
    high: number;
    unit: string;
  };
  restartDelay: {
    low: number;
    high: number;
    unit: string;
  };
  maxRestarts: {
    low: number;
    high: number;
    unit: string;
  };
  maxMemoryRestartMegabytes: {
    low: number;
    high: number;
    unit: string;
  };
};
//#endregion
//#region src/extensions.d.ts
declare const APP_EXTENSION_TYPES: readonly ["interface", "display", "layout", "module", "panel", "theme"];
declare const API_EXTENSION_TYPES: readonly ["hook", "endpoint"];
declare const HYBRID_EXTENSION_TYPES: readonly ["operation"];
declare const BUNDLE_EXTENSION_TYPES: readonly ["bundle"];
declare const EXTENSION_TYPES: readonly ["interface", "display", "layout", "module", "panel", "theme", "hook", "endpoint", "operation", "bundle"];
declare const NESTED_EXTENSION_TYPES: readonly ["interface", "display", "layout", "module", "panel", "theme", "hook", "endpoint", "operation"];
declare const APP_OR_HYBRID_EXTENSION_TYPES: readonly ["interface", "display", "layout", "module", "panel", "theme", "operation"];
declare const APP_OR_HYBRID_EXTENSION_PACKAGE_TYPES: readonly ["interface", "display", "layout", "module", "panel", "theme", "operation", "bundle"];
//#endregion
//#region src/fields.d.ts
declare const KNEX_TYPES: readonly ["bigInteger", "boolean", "date", "dateTime", "decimal", "float", "integer", "json", "string", "text", "time", "timestamp", "binary", "uuid"];
declare const TYPES: readonly ["bigInteger", "boolean", "date", "dateTime", "decimal", "float", "integer", "json", "string", "text", "time", "timestamp", "binary", "uuid", "alias", "hash", "csv", "geometry", "geometry.Point", "geometry.LineString", "geometry.Polygon", "geometry.MultiPoint", "geometry.MultiLineString", "geometry.MultiPolygon", "unknown"];
declare const NUMERIC_TYPES: readonly ["bigInteger", "decimal", "float", "integer"];
declare const GEOMETRY_TYPES: readonly ["Point", "LineString", "Polygon", "MultiPoint", "MultiLineString", "MultiPolygon"];
declare const GEOMETRY_FORMATS: readonly ["native", "geojson", "wkt", "lnglat"];
declare const LOCAL_TYPES: readonly ["standard", "file", "files", "m2o", "o2m", "m2m", "m2a", "presentation", "translations", "group"];
declare const RELATIONAL_TYPES: readonly ["file", "files", "m2o", "o2m", "m2m", "m2a", "presentation", "translations", "group"];
declare const FUNCTIONS: readonly ["year", "month", "week", "day", "weekday", "hour", "minute", "second", "count"];
//#endregion
//#region src/files.d.ts
declare const JAVASCRIPT_FILE_EXTS: readonly ["js", "mjs", "cjs"];
declare const DEFAULT_CHUNK_SIZE = 8388608;
//#endregion
//#region src/injection.d.ts
declare const STORES_INJECT = "stores";
declare const API_INJECT = "api";
declare const SDK_INJECT = "sdk";
declare const EXTENSIONS_INJECT = "extensions";
//#endregion
//#region src/items.d.ts
/**
 * Keys of a nested relational mutation input (the `Alterations` type in `@directus/types`):
 * `create` new children, `update` existing children by primary key, `delete` children by primary key.
 */
declare const ALTERATIONS_KEYS: readonly ["create", "update", "delete"];
//#endregion
//#region src/number.d.ts
declare const DEFAULT_NUMERIC_PRECISION = 10;
declare const DEFAULT_NUMERIC_SCALE = 5;
declare const MAX_SAFE_INT64: bigint;
declare const MIN_SAFE_INT64: bigint;
declare const MAX_SAFE_INT32: number;
declare const MIN_SAFE_INT32: number;
//#endregion
//#region src/permissions.d.ts
declare const PERMISSION_ACTIONS: readonly ["create", "read", "update", "delete", "share"];
//#endregion
//#region src/regex.d.ts
declare const REGEX_BETWEEN_PARENS: RegExp;
//#endregion
export { ALTERATIONS_KEYS, API_EXTENSION_TYPES, API_INJECT, APP_EXTENSION_TYPES, APP_OR_HYBRID_EXTENSION_PACKAGE_TYPES, APP_OR_HYBRID_EXTENSION_TYPES, AUTOSCALE_BOUNDS, Action, AutoscaleBound, BUNDLE_EXTENSION_TYPES, DEFAULT_CHUNK_SIZE, DEFAULT_NUMERIC_PRECISION, DEFAULT_NUMERIC_SCALE, EXTENSIONS_INJECT, EXTENSION_TYPES, FUNCTIONS, GEOMETRY_FORMATS, GEOMETRY_TYPES, HYBRID_EXTENSION_TYPES, JAVASCRIPT_FILE_EXTS, KNEX_TYPES, LEGACY_SAMPLE_WINDOW, LOCAL_TYPES, MAX_PACING_SECONDS, MAX_SAFE_INT32, MAX_SAFE_INT64, MAX_SUPPORTED_WORKERS, MIN_SAFE_INT32, MIN_SAFE_INT64, NESTED_EXTENSION_TYPES, NUMERIC_TYPES, PERMISSION_ACTIONS, REGEX_BETWEEN_PARENS, RELATIONAL_TYPES, SDK_INJECT, STORES_INJECT, SUPERVISOR_BOUNDS, TYPES };