import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { cwd } from "node:process";
import { DEFAULT_CHUNK_SIZE, JAVASCRIPT_FILE_EXTS } from "@directus/constants";
import { isIn, parseJSON, toArray, toBoolean } from "@directus/utils";
import { isPlainObject, toNumber, toString } from "lodash-es";
import { parse } from "dotenv";
import { requireYaml } from "@directus/utils/node";

//#region src/constants/defaults.ts
const DEFAULTS = {
	CONFIG_PATH: resolve(cwd(), ".env"),
	HOST: "0.0.0.0",
	PORT: 8055,
	PUBLIC_URL: "/",
	MAX_PAYLOAD_SIZE: "1mb",
	MAX_RELATIONAL_DEPTH: 10,
	QUERYSTRING_MAX_PARSE_DEPTH: 10,
	QUERYSTRING_ARRAY_LIMIT: 500,
	QUERY_LIMIT_DEFAULT: 100,
	MAX_BATCH_MUTATION: Infinity,
	MAX_IMPORT_ERRORS: 1e3,
	ROBOTS_TXT: "User-agent: *\nDisallow: /",
	TEMP_PATH: "./node_modules/.directus",
	DB_EXCLUDE_TABLES: "spatial_ref_sys,sysdiagrams",
	STORAGE_LOCATIONS: "local",
	STORAGE_LOCAL_DRIVER: "local",
	STORAGE_LOCAL_ROOT: "./uploads",
	RATE_LIMITER_ENABLED: false,
	RATE_LIMITER_POINTS: 50,
	RATE_LIMITER_DURATION: 1,
	RATE_LIMITER_STORE: "memory",
	RATE_LIMITER_GLOBAL_ENABLED: false,
	RATE_LIMITER_GLOBAL_POINTS: 1e3,
	RATE_LIMITER_GLOBAL_DURATION: 1,
	RATE_LIMITER_REGISTRATION_ENABLED: true,
	RATE_LIMITER_REGISTRATION_POINTS: 5,
	RATE_LIMITER_REGISTRATION_DURATION: 60,
	RATE_LIMITER_MCP_OAUTH_ENABLED: true,
	RATE_LIMITER_MCP_OAUTH_POINTS: 60,
	RATE_LIMITER_MCP_OAUTH_DURATION: 60,
	RATE_LIMITER_MCP_OAUTH_REGISTRATION_ENABLED: true,
	RATE_LIMITER_MCP_OAUTH_REGISTRATION_POINTS: 30,
	RATE_LIMITER_MCP_OAUTH_REGISTRATION_DURATION: 60,
	RATE_LIMITER_EMAIL_ENABLED: false,
	RATE_LIMITER_EMAIL_POINTS: 60,
	RATE_LIMITER_EMAIL_DURATION: 60,
	RATE_LIMITER_EMAIL_QUEUE_SIZE: 1e6,
	RATE_LIMITER_EMAIL_FLOWS_ENABLED: false,
	RATE_LIMITER_EMAIL_FLOWS_POINTS: 1,
	RATE_LIMITER_EMAIL_FLOWS_DURATION: 60,
	ACCESS_TOKEN_TTL: "15m",
	EMAIL_VERIFICATION_TOKEN_TTL: "7d",
	REFRESH_TOKEN_TTL: "7d",
	REFRESH_TOKEN_COOKIE_NAME: "directus_refresh_token",
	REFRESH_TOKEN_COOKIE_SECURE: false,
	REFRESH_TOKEN_COOKIE_SAME_SITE: "lax",
	SESSION_COOKIE_TTL: "1d",
	SESSION_COOKIE_NAME: "directus_session_token",
	SESSION_COOKIE_SECURE: false,
	SESSION_COOKIE_SAME_SITE: "lax",
	SESSION_REFRESH_GRACE_PERIOD: "10s",
	USER_INVITE_TOKEN_TTL: "7d",
	LOGIN_STALL_TIME: 500,
	REGISTER_STALL_TIME: 750,
	SERVER_SHUTDOWN_TIMEOUT: 1e3,
	ROOT_REDIRECT: "./admin",
	CORS_ENABLED: false,
	CORS_ORIGIN: false,
	CORS_METHODS: "GET,POST,PATCH,DELETE",
	CORS_ALLOWED_HEADERS: "Content-Type,Authorization",
	CORS_EXPOSED_HEADERS: "Content-Range",
	CORS_CREDENTIALS: true,
	CORS_MAX_AGE: 18e3,
	CACHE_ENABLED: false,
	CACHE_STORE: "memory",
	CACHE_TTL: "5m",
	CACHE_NAMESPACE: "system-cache",
	CACHE_AUTO_PURGE: false,
	CACHE_AUTO_PURGE_IGNORE_LIST: "directus_activity,directus_presets",
	CACHE_CONTROL_S_MAXAGE: "0",
	CACHE_SCHEMA: true,
	CACHE_SCHEMA_MAX_ITERATIONS: 100,
	CACHE_SCHEMA_SYNC_TIMEOUT: 1e4,
	CACHE_SCHEMA_FREEZE_ENABLED: false,
	CACHE_VALUE_MAX_SIZE: false,
	CACHE_SKIP_ALLOWED: false,
	AUTH_PROVIDERS: "",
	AUTH_DISABLE_DEFAULT: false,
	PACKAGE_FILE_LOCATION: ".",
	EXTENSIONS_PATH: "./extensions",
	EXTENSIONS_MUST_LOAD: false,
	EXTENSIONS_AUTO_RELOAD: false,
	EXTENSIONS_SANDBOX_MEMORY: 100,
	EXTENSIONS_SANDBOX_TIMEOUT: 1e3,
	EXTENSIONS_ROLLDOWN: false,
	MIGRATIONS_PATH: "./migrations",
	EMAIL_FROM: "no-reply@example.com",
	EMAIL_VERIFY_SETUP: true,
	EMAIL_TRANSPORT: "sendmail",
	EMAIL_SENDMAIL_NEW_LINE: "unix",
	EMAIL_SENDMAIL_PATH: "/usr/sbin/sendmail",
	EMAIL_TEMPLATES_PATH: "./templates",
	MARKETPLACE_TRUST: "sandbox",
	TELEMETRY: true,
	TELEMETRY_URL: "https://telemetry.directus.io",
	COMPLIANCE_URL: "https://telemetry.directus.io",
	ASSETS_CACHE_TTL: "30d",
	ASSETS_CACHE_REVALIDATE: false,
	ASSETS_TRANSFORM_MAX_CONCURRENT: 25,
	ASSETS_TRANSFORM_IMAGE_MAX_DIMENSION: 6e3,
	ASSETS_TRANSFORM_MAX_OPERATIONS: 5,
	ASSETS_TRANSFORM_TIMEOUT: "7500ms",
	ASSETS_INVALID_IMAGE_SENSITIVITY_LEVEL: "warning",
	IP_TRUST_PROXY: false,
	IP_CUSTOM_HEADER: false,
	IMPORT_EXPORT_NAMESPACE: "directus:import-export",
	IMPORT_IP_DENY_LIST: ["0.0.0.0", "169.254.169.254"],
	IMPORT_TIMEOUT: "1h",
	IMPORT_MAX_CONCURRENCY: 20,
	SERVE_APP: true,
	RELATIONAL_BATCH_SIZE: 25e3,
	EXPORT_BATCH_SIZE: 5e3,
	USERS_ADMIN_ACCESS_LIMIT: Infinity,
	USERS_APP_ACCESS_LIMIT: Infinity,
	USERS_API_ACCESS_LIMIT: Infinity,
	MAX_JSON_QUERY_DEPTH: 10,
	FILE_METADATA_ALLOW_LIST: "ifd0.Make,ifd0.Model,exif.FNumber,exif.ExposureTime,exif.FocalLength,exif.ISOSpeedRatings",
	TUS_ENABLED: false,
	TUS_CHUNK_SIZE: DEFAULT_CHUNK_SIZE,
	TUS_UPLOAD_EXPIRATION: "10m",
	TUS_CLEANUP_SCHEDULE: "0 * * * *",
	RETENTION_ENABLED: false,
	RETENTION_BATCH: 500,
	RETENTION_SCHEDULE: "0 0 * * *",
	ACTIVITY_RETENTION: "90d",
	REVISIONS_RETENTION: "90d",
	FLOW_LOGS_RETENTION: "90d",
	OPENAPI_ENABLED: true,
	GRAPHQL_INTROSPECTION: true,
	GRAPHQL_SCHEMA_GENERATION_MAX_CONCURRENT: 5,
	GRAPHQL_QUERY_TOKEN_LIMIT: 5e3,
	WEBSOCKETS_ENABLED: false,
	WEBSOCKETS_REST_ENABLED: true,
	WEBSOCKETS_REST_AUTH: "handshake",
	WEBSOCKETS_REST_AUTH_TIMEOUT: 10,
	WEBSOCKETS_REST_PATH: "/websocket",
	WEBSOCKETS_GRAPHQL_ENABLED: true,
	WEBSOCKETS_GRAPHQL_AUTH: "handshake",
	WEBSOCKETS_GRAPHQL_AUTH_TIMEOUT: 10,
	WEBSOCKETS_GRAPHQL_PATH: "/graphql",
	WEBSOCKETS_HEARTBEAT_ENABLED: true,
	WEBSOCKETS_HEARTBEAT_PERIOD: 30,
	WEBSOCKETS_LOGS_ENABLED: true,
	WEBSOCKETS_LOGS_PATH: "/websocket/logs",
	WEBSOCKETS_COLLAB_ENABLED: true,
	WEBSOCKETS_COLLAB_INSTANCE_TIMEOUT: 1e4,
	WEBSOCKETS_COLLAB_PERMISSIONS_CACHE_CAPACITY: 2e3,
	WEBSOCKETS_COLLAB_CLUSTER_CLEANUP_CRON: "*/1 * * * *",
	WEBSOCKETS_COLLAB_LOCAL_CLEANUP_INTERVAL: 6e4,
	WEBSOCKETS_COLLAB_STORE_NAMESPACE: "collab",
	FLOWS_ENV_ALLOW_LIST: false,
	FLOWS_RUN_SCRIPT_MAX_MEMORY: 32,
	FLOWS_RUN_SCRIPT_TIMEOUT: 1e4,
	PRESSURE_LIMITER_ENABLED: true,
	PRESSURE_LIMITER_SAMPLE_INTERVAL: 250,
	PRESSURE_LIMITER_MAX_EVENT_LOOP_UTILIZATION: .99,
	PRESSURE_LIMITER_MAX_EVENT_LOOP_DELAY: 500,
	PRESSURE_LIMITER_MAX_MEMORY_RSS: false,
	PRESSURE_LIMITER_MAX_MEMORY_HEAP_USED: false,
	PRESSURE_LIMITER_RETRY_AFTER: false,
	HEALTHCHECK_ENABLED: true,
	HEALTHCHECK_NAMESPACE: "directus:healthcheck",
	HEALTHCHECK_SERVICES: "database,redis,storage,email",
	HEALTHCHECK_CACHE_TTL: "5m",
	METRICS_ENABLED: false,
	METRICS_SERVICES: "database,cache,redis,storage",
	METRICS_SCHEDULE: "*/1 * * * *",
	METRICS_NAME_PREFIX: "directus_",
	METRICS_HEALTH_CHECK_PREFIX: "directus-metric-",
	FILES_MIME_TYPE_ALLOW_LIST: "*/*",
	FILES_DELETE_ORIGINAL_ON_MOVE: false,
	FILES_MAX_UPLOAD_CONCURRENCY: Infinity,
	CROSS_ORIGIN_OPENER_POLICY_ENABLED: true,
	CROSS_ORIGIN_OPENER_POLICY: "same-origin-allow-popups",
	ACCEPT_TERMS: false,
	AUTOSAVE_REVISION_INTERVAL: 300,
	MCP_ENABLED: true,
	MCP_OAUTH_ENABLED: false,
	MCP_OAUTH_AUTH_CODE_TTL: "60s",
	MCP_OAUTH_MAX_CLIENTS: 1e4,
	MCP_OAUTH_CLIENT_UNUSED_TTL: "24h",
	MCP_OAUTH_CLIENT_IDLE_TTL: "0",
	MCP_OAUTH_REQUIRE_RESOURCE: false,
	MCP_OAUTH_CLEANUP_SCHEDULE: "*/15 * * * *",
	MCP_OAUTH_ALLOWED_REDIRECT_DOMAINS: "",
	MCP_OAUTH_ALLOWED_CUSTOM_REDIRECTS: "raycast://oauth,cursor://cursor.mcp,cursor://anysphere.cursor-mcp",
	MCP_OAUTH_DCR_ENABLED: false,
	MCP_OAUTH_CIMD_ENABLED: false,
	MCP_OAUTH_CIMD_ALLOW_HTTP: false,
	MCP_OAUTH_CIMD_ALLOWED_DOMAINS: "",
	MCP_OAUTH_CIMD_BLOCKED_TLDS: "test,localhost,invalid,example,local,onion",
	AI_ENABLED: true,
	AI_DEVTOOLS_ENABLED: false,
	AI_TELEMETRY_ENABLED: false,
	AI_TELEMETRY_PROVIDER: "langfuse",
	AI_TELEMETRY_RECORD_IO: false,
	LANGFUSE_SECRET_KEY: "",
	LANGFUSE_PUBLIC_KEY: "",
	LANGFUSE_BASE_URL: "https://cloud.langfuse.com",
	BRAINTRUST_API_KEY: "",
	BRAINTRUST_PROJECT_NAME: "",
	BRAINTRUST_API_URL: "",
	LICENSE_NAMESPACE: "license"
};

//#endregion
//#region src/utils/get-config-path.ts
/**
* Get the file location on the local filesystem of the config file
*/
const getConfigPath = () => {
	return resolve(process.env["CONFIG_PATH"] || DEFAULTS["CONFIG_PATH"]);
};

//#endregion
//#region src/constants/type-map.ts
/**
* Environment variables that we expect to be in a certain type. Will set the default casting of
* those values
*/
const TYPE_MAP = {
	HOST: "string",
	PORT: "string",
	DB_NAME: "string",
	DB_USER: "string",
	DB_PASSWORD: "string",
	DB_DATABASE: "string",
	DB_PORT: "number",
	DB_EXCLUDE_TABLES: "array",
	CACHE_SKIP_ALLOWED: "boolean",
	CACHE_AUTO_PURGE_IGNORE_LIST: "array",
	CACHE_SCHEMA_MAX_ITERATIONS: "number",
	CACHE_SCHEMA_SYNC_TIMEOUT: "number",
	CACHE_SCHEMA_FREEZE_ENABLED: "boolean",
	IMPORT_IP_DENY_LIST: "array",
	IMPORT_TIMEOUT: "string",
	IMPORT_MAX_CONCURRENCY: "number",
	IMPORT_EXPORT_NAMESPACE: "string",
	FILE_METADATA_ALLOW_LIST: "array",
	FILES_DELETE_ORIGINAL_ON_MOVE: "boolean",
	ASSETS_CACHE_REVALIDATE: "boolean",
	OPENAPI_ENABLED: "boolean",
	GRAPHQL_INTROSPECTION: "boolean",
	GRAPHQL_SCHEMA_GENERATION_MAX_CONCURRENT: "number",
	MAX_BATCH_MUTATION: "number",
	MAX_IMPORT_ERRORS: "number",
	SERVER_SHUTDOWN_TIMEOUT: "number",
	LOG_HTTP_IGNORE_PATHS: "array",
	REDIS_ENABLED: "boolean",
	REDIS_PASSWORD: "string",
	REDIS_BUS_NAMESPACE: "string",
	REDIS_LOCK_NAMESPACE: "string",
	REDIS_COUNTERS_NAMESPACE: "string",
	REDIS_PERMISSIONS_NAMESPACE: "string",
	HEALTHCHECK_ENABLED: "boolean",
	HEALTHCHECK_NAMESPACE: "string",
	HEALTHCHECK_SERVICES: "array",
	HEALTHCHECK_CACHE_TTL: "string",
	METRICS_TOKENS: "array",
	METRICS_SERVICES: "array",
	METRICS_HEALTH_CHECK_PREFIX: "string",
	DB_SSL__CA_FILE: "string",
	ADMIN_PASSWORD: "string",
	ADMIN_TOKEN: "string",
	KEY: "string",
	SECRET: "string",
	EXTENSIONS_ROLLDOWN: "boolean",
	MCP_OAUTH_ENABLED: "boolean",
	MCP_OAUTH_AUTH_CODE_TTL: "string",
	MCP_OAUTH_MAX_CLIENTS: "number",
	MCP_OAUTH_CLIENT_UNUSED_TTL: "string",
	MCP_OAUTH_CLIENT_IDLE_TTL: "string",
	MCP_OAUTH_REQUIRE_RESOURCE: "boolean",
	MCP_OAUTH_CLEANUP_SCHEDULE: "string",
	MCP_OAUTH_ALLOWED_REDIRECT_DOMAINS: "array",
	MCP_OAUTH_ALLOWED_CUSTOM_REDIRECTS: "array",
	MCP_OAUTH_DCR_ENABLED: "boolean",
	MCP_OAUTH_CIMD_ENABLED: "boolean",
	MCP_OAUTH_CIMD_ALLOW_HTTP: "boolean",
	MCP_OAUTH_CIMD_ALLOWED_DOMAINS: "array",
	MCP_OAUTH_CIMD_BLOCKED_TLDS: "array",
	EMAIL_SMTP_PASSWORD: "string",
	"STORAGE_.+_SECRET": "string",
	"AUTH_.+_BIND_DN": "string",
	"AUTH_.+_USER_DN": "string",
	"AUTH_.+_GROUP_DN": "string",
	"AUTH_.+_BIND_PASSWORD": "string",
	"AUTH_.+_COOKIE_SECURE": "boolean"
};
const TYPE_MAP_REGEX = Object.entries(TYPE_MAP).map(([name, value]) => [/* @__PURE__ */ new RegExp(`^${name}$`), value]);

//#endregion
//#region src/utils/get-default-type.ts
const getDefaultType = (key) => {
	if (!key) return null;
	const type = TYPE_MAP_REGEX.find(([map_key, _]) => map_key.test(key));
	if (type !== void 0) return type[1];
	return null;
};

//#endregion
//#region src/constants/env-types.ts
/**
* Casting flags that are read from env var values. For example `number:1` is read as `1` instead of
* `'1'`
*/
const ENV_TYPES = [
	"string",
	"number",
	"regex",
	"array",
	"json",
	"boolean"
];

//#endregion
//#region src/utils/has-cast-prefix.ts
const getCastFlag = (value) => {
	if (typeof value !== "string") return null;
	if (value.includes(":") === false) return null;
	const castPrefix = value.split(":")[0];
	if (isIn(castPrefix, ENV_TYPES) === false) return null;
	return castPrefix;
};

//#endregion
//#region src/constants/directus-variables.ts
/**
* Variables in the environment that Directus will read as configuration
*/
const DIRECTUS_VARIABLES = [
	"CONFIG_PATH",
	"HOST",
	"PORT",
	"PUBLIC_URL",
	"LOG_LEVEL",
	"LOG_STYLE",
	"LOG_HTTP_IGNORE_PATHS",
	"MAX_PAYLOAD_SIZE",
	"ROOT_REDIRECT",
	"SERVE_APP",
	"OPENAPI_ENABLED",
	"GRAPHQL_INTROSPECTION",
	"GRAPHQL_SCHEMA_CACHE_CAPACITY",
	"GRAPHQL_SCHEMA_GENERATION_MAX_CONCURRENT",
	"GRAPHQL_QUERY_TOKEN_LIMIT",
	"MAX_BATCH_MUTATION",
	"MAX_IMPORT_ERRORS",
	"LOGGER_.+",
	"QUERYSTRING_MAX_PARSE_DEPTH",
	"QUERYSTRING_ARRAY_LIMIT",
	"QUERY_LIMIT_MAX",
	"QUERY_LIMIT_DEFAULT",
	"ROBOTS_TXT",
	"TEMP_PATH",
	"PROJECT_OWNER",
	"MARKETPLACE_REGISTRY",
	"MARKETPLACE_TRUST",
	"SERVER_.+",
	"DB_.+",
	"SECRET",
	"ACCESS_TOKEN_TTL",
	"EMAIL_VERIFICATION_TOKEN_TTL",
	"REFRESH_TOKEN_TTL",
	"REFRESH_TOKEN_COOKIE_NAME",
	"REFRESH_TOKEN_COOKIE_DOMAIN",
	"REFRESH_TOKEN_COOKIE_SECURE",
	"REFRESH_TOKEN_COOKIE_SAME_SITE",
	"SESSION_COOKIE_TTL",
	"SESSION_COOKIE_NAME",
	"SESSION_COOKIE_DOMAIN",
	"SESSION_COOKIE_SECURE",
	"SESSION_COOKIE_SAME_SITE",
	"SESSION_REFRESH_GRACE_PERIOD",
	"REDIS",
	"REDIS_ENABLED",
	"REDIS_HOST",
	"REDIS_PORT",
	"REDIS_USERNAME",
	"REDIS_PASSWORD",
	"REDIS_DB",
	"REDIS_BUS_NAMESPACE",
	"REDIS_LOCK_NAMESPACE",
	"REDIS_COUNTERS_NAMESPACE",
	"REDIS_PERMISSIONS_NAMESPACE",
	"LOGIN_STALL_TIME",
	"REGISTER_STALL_TIME",
	"PASSWORD_RESET_URL_ALLOW_LIST",
	"USER_INVITE_TOKEN_TTL",
	"USER_INVITE_URL_ALLOW_LIST",
	"USER_REGISTER_URL_ALLOW_LIST",
	"IP_TRUST_PROXY",
	"IP_CUSTOM_HEADER",
	"ASSETS_CONTENT_SECURITY_POLICY",
	"IMPORT_IP_DENY_LIST",
	"IMPORT_TIMEOUT",
	"IMPORT_MAX_CONCURRENCY",
	"IMPORT_EXPORT_NAMESPACE",
	"CONTENT_SECURITY_POLICY_.+",
	"CROSS_ORIGIN_OPENER_POLICY_ENABLED",
	"CROSS_ORIGIN_OPENER_POLICY",
	"HSTS_.+",
	"HASH_.+",
	"CORS_ENABLED",
	"CORS_ORIGIN",
	"CORS_METHODS",
	"CORS_ALLOWED_HEADERS",
	"CORS_EXPOSED_HEADERS",
	"CORS_CREDENTIALS",
	"CORS_MAX_AGE",
	"RATE_LIMITER_.+",
	"CACHE_ENABLED",
	"CACHE_TTL",
	"CACHE_CONTROL_S_MAXAGE",
	"CACHE_AUTO_PURGE",
	"CACHE_AUTO_PURGE_IGNORE_LIST",
	"CACHE_SYSTEM_TTL",
	"CACHE_DEPLOYMENT_TTL",
	"CACHE_SCHEMA",
	"CACHE_SCHEMA_MAX_ITERATIONS",
	"CACHE_SCHEMA_SYNC_TIMEOUT",
	"CACHE_SCHEMA_FREEZE_ENABLED",
	"CACHE_NAMESPACE",
	"CACHE_STORE",
	"CACHE_STATUS_HEADER",
	"CACHE_VALUE_MAX_SIZE",
	"CACHE_SKIP_ALLOWED",
	"CACHE_HEALTHCHECK_THRESHOLD",
	"HEALTHCHECK_ENABLED",
	"HEALTHCHECK_NAMESPACE",
	"HEALTHCHECK_SERVICES",
	"HEALTHCHECK_CACHE_TTL",
	"STORAGE_LOCATIONS",
	"STORAGE_.+_DRIVER",
	"STORAGE_.+_ROOT",
	"STORAGE_.+_KEY",
	"STORAGE_.+_SECRET",
	"STORAGE_.+_BUCKET",
	"STORAGE_.+_REGION",
	"STORAGE_.+_ENDPOINT",
	"STORAGE_.+_ACL",
	"STORAGE_.+_CONTAINER_NAME",
	"STORAGE_.+_SERVER_SIDE_ENCRYPTION",
	"STORAGE_.+_SERVER_SIDE_ENCRYPTION_KMS_KEY_ID",
	"STORAGE_.+_ACCOUNT_NAME",
	"STORAGE_.+_ACCOUNT_KEY",
	"STORAGE_.+_ENDPOINT",
	"STORAGE_.+_KEY_FILENAME",
	"STORAGE_.+_BUCKET",
	"STORAGE_.+_HEALTHCHECK_THRESHOLD",
	"FILE_METADATA_ALLOW_LIST",
	"FILES_MAX_UPLOAD_SIZE",
	"FILES_MAX_UPLOAD_CONCURRENCY",
	"FILES_CONTENT_TYPE_ALLOW_LIST",
	"FILES_DELETE_ORIGINAL_ON_MOVE",
	"ASSETS_CACHE_TTL",
	"ASSETS_CACHE_REVALIDATE",
	"ASSETS_TRANSFORM_MAX_CONCURRENT",
	"ASSETS_TRANSFORM_IMAGE_MAX_DIMENSION",
	"ASSETS_TRANSFORM_MAX_OPERATIONS",
	"ASSETS_TRANSFORM_TIMEOUT",
	"ASSETS_CONTENT_SECURITY_POLICY",
	"ASSETS_INVALID_IMAGE_SENSITIVITY_LEVEL",
	"AUTH_PROVIDERS",
	"AUTH_ALLOWED_PUBLIC_URLS",
	"AUTH_DISABLE_DEFAULT",
	"AUTH_.+_DRIVER",
	"AUTH_.+_CLIENT_ID",
	"AUTH_.+_CLIENT_SECRET",
	"AUTH_.+_SCOPE",
	"AUTH_.+_AUTHORIZE_URL",
	"AUTH_.+_ACCESS_URL",
	"AUTH_.+_PROFILE_URL",
	"AUTH_.+_IDENTIFIER_KEY",
	"AUTH_.+_EMAIL_KEY",
	"AUTH_.+_FIRST_NAME_KEY",
	"AUTH_.+_LAST_NAME_KEY",
	"AUTH_.+_ALLOW_PUBLIC_REGISTRATION",
	"AUTH_.+_DEFAULT_ROLE_ID",
	"AUTH_.+_SYNC_USER_INFO",
	"AUTH_.+_ICON",
	"AUTH_.+_LABEL",
	"AUTH_.+_PARAMS",
	"AUTH_.+_ISSUER_URL",
	"AUTH_.+_ISSUER_DISCOVERY_MUST_SUCCEED",
	"AUTH_.+_CLIENT_HTTP_.+",
	"AUTH_.+_AUTH_REQUIRE_VERIFIED_EMAIL",
	"AUTH_.+_CLIENT_URL",
	"AUTH_.+_BIND_DN",
	"AUTH_.+_BIND_PASSWORD",
	"AUTH_.+_USER_DN",
	"AUTH_.+_USER_ATTRIBUTE",
	"AUTH_.+_USER_SCOPE",
	"AUTH_.+_MAIL_ATTRIBUTE",
	"AUTH_.+_FIRST_NAME_ATTRIBUTE",
	"AUTH_.+_LAST_NAME_ATTRIBUTE",
	"AUTH_.+_GROUP_DN",
	"AUTH_.+_GROUP_ATTRIBUTE",
	"AUTH_.+_GROUP_SCOPE",
	"AUTH_.+_IDP.+",
	"AUTH_.+_SP.+",
	"AUTH_.+_REDIRECT_ALLOW_LIST",
	"AUTH_.+_COOKIE_SECURE",
	"PACKAGE_FILE_LOCATION",
	"EXTENSIONS_LOCATION",
	"EXTENSIONS_PATH",
	"EXTENSIONS_MUST_LOAD",
	"EXTENSIONS_AUTO_RELOAD",
	"EXTENSIONS_CACHE_TTL",
	"EXTENSIONS_SANDBOX_MEMORY",
	"EXTENSIONS_SANDBOX_TIMEOUT",
	"EXTENSIONS_LIMIT",
	"EXTENSIONS_ROLLDOWN",
	"MIGRATIONS_PATH",
	"SYNCHRONIZATION_STORE",
	"SYNCHRONIZATION_NAMESPACE",
	"EMAIL_FROM",
	"EMAIL_TRANSPORT",
	"EMAIL_VERIFY_SETUP",
	"EMAIL_SENDMAIL_NEW_LINE",
	"EMAIL_SENDMAIL_PATH",
	"EMAIL_SMTP_NAME",
	"EMAIL_SMTP_HOST",
	"EMAIL_SMTP_PORT",
	"EMAIL_SMTP_USER",
	"EMAIL_SMTP_PASSWORD",
	"EMAIL_SMTP_POOL",
	"EMAIL_SMTP_SECURE",
	"EMAIL_SMTP_IGNORE_TLS",
	"EMAIL_MAILGUN_API_KEY",
	"EMAIL_MAILGUN_DOMAIN",
	"EMAIL_MAILGUN_HOST",
	"EMAIL_SES_CREDENTIALS__ACCESS_KEY_ID",
	"EMAIL_SES_CREDENTIALS__SECRET_ACCESS_KEY",
	"EMAIL_SES_REGION",
	"EMAIL_TEMPLATES_PATH",
	"ADMIN_EMAIL",
	"ADMIN_PASSWORD",
	"ADMIN_TOKEN",
	"TELEMETRY",
	"TELEMETRY_URL",
	"COMPLIANCE_URL",
	"TELEMETRY_AUTHORIZATION",
	"RELATIONAL_BATCH_SIZE",
	"EXPORT_BATCH_SIZE",
	"USERS_ADMIN_ACCESS_LIMIT",
	"USERS_APP_ACCESS_LIMIT",
	"USERS_API_ACCESS_LIMIT",
	"MAX_JSON_QUERY_DEPTH",
	"FLOWS_ENV_ALLOW_LIST",
	"FLOWS_RUN_SCRIPT_MAX_MEMORY",
	"FLOWS_RUN_SCRIPT_TIMEOUT",
	"WEBSOCKETS_.+",
	"METRICS_ENABLED",
	"METRICS_SCHEDULE",
	"METRICS_TOKENS",
	"METRICS_SERVICES",
	"METRICS_HEALTH_CHECK_PREFIX",
	"METRICS_NAME_PREFIX",
	"AUTOSAVE_REVISION_INTERVAL",
	"MCP_ENABLED",
	"MCP_OAUTH_ENABLED",
	"MCP_OAUTH_AUTH_CODE_TTL",
	"MCP_OAUTH_MAX_CLIENTS",
	"MCP_OAUTH_CLIENT_UNUSED_TTL",
	"MCP_OAUTH_CLIENT_IDLE_TTL",
	"MCP_OAUTH_REQUIRE_RESOURCE",
	"MCP_OAUTH_CLEANUP_SCHEDULE",
	"MCP_OAUTH_ALLOWED_REDIRECT_DOMAINS",
	"MCP_OAUTH_ALLOWED_CUSTOM_REDIRECTS",
	"MCP_OAUTH_DCR_ENABLED",
	"MCP_OAUTH_CIMD_ENABLED",
	"MCP_OAUTH_CIMD_ALLOW_HTTP",
	"MCP_OAUTH_CIMD_ALLOWED_DOMAINS",
	"MCP_OAUTH_CIMD_BLOCKED_TLDS",
	"AI_ENABLED",
	"AI_DEVTOOLS_ENABLED",
	"AI_TELEMETRY_ENABLED",
	"AI_TELEMETRY_PROVIDER",
	"AI_TELEMETRY_RECORD_IO",
	"LANGFUSE_SECRET_KEY",
	"LANGFUSE_PUBLIC_KEY",
	"LANGFUSE_BASE_URL",
	"BRAINTRUST_API_KEY",
	"BRAINTRUST_PROJECT_NAME",
	"BRAINTRUST_API_URL",
	"LICENSE_KEY",
	"LICENSE_TOKEN",
	"LICENSE_NAMESPACE"
];
/**
* Variables in the environment that Directus will read as configuration in RegExp format
*/
const DIRECTUS_VARIABLES_REGEX = DIRECTUS_VARIABLES.map((name) => /* @__PURE__ */ new RegExp(`^${name}$`));

//#endregion
//#region src/utils/is-directus-variable.ts
const isDirectusVariable = (key) => {
	if (key.endsWith("_FILE")) key = key.slice(0, -5);
	return DIRECTUS_VARIABLES_REGEX.some((regex) => regex.test(key));
};

//#endregion
//#region src/utils/is-file-key.ts
/**
* If the current variable key points to a file that holds the value
*/
const isFileKey = (key) => key.length > 5 && key.endsWith("_FILE");

//#endregion
//#region src/utils/read-configuration-from-process.ts
/**
* Returns the raw variables from the process
*/
const readConfigurationFromProcess = () => {
	return { ...process.env };
};

//#endregion
//#region src/utils/remove-file-suffix.ts
/**
* Convert a _FILE property back to the config option key name
*/
const removeFileSuffix = (key) => key.slice(0, -5);

//#endregion
//#region src/utils/guess-type.ts
const guessType = (value) => {
	if (typeof value === "boolean" || value === "true" || value === "false") return "boolean";
	if (typeof value === "number" || !String(value).startsWith("0") && !isNaN(Number(value)) && String(value).length > 0 && Number(value) >= Number.MIN_SAFE_INTEGER && Number(value) <= Number.MAX_SAFE_INTEGER) return "number";
	if (Array.isArray(value) || String(value).includes(",")) return "array";
	return "json";
};

//#endregion
//#region src/utils/try-json.ts
const tryJson = (value) => {
	try {
		return parseJSON(String(value));
	} catch {
		return value;
	}
};

//#endregion
//#region src/lib/cast.ts
const cast = (value, key) => {
	const castFlag = getCastFlag(value);
	const type = castFlag ?? getDefaultType(key) ?? guessType(value);
	if (typeof value === "string" && castFlag) value = value.substring(castFlag.length + 1);
	switch (type) {
		case "string": return toString(value);
		case "number": return toNumber(value);
		case "boolean": return toBoolean(value);
		case "regex": return new RegExp(String(value));
		case "array": return toArray(value).map((v) => cast(v)).filter((v) => v !== "");
		case "json": return tryJson(value);
	}
};

//#endregion
//#region src/utils/get-file-extension.ts
/**
* Returns the file extension of a given file path
*/
const getFileExtension = (path) => {
	return extname(path).toLowerCase().substring(1);
};

//#endregion
//#region src/utils/read-configuration-from-dotenv.ts
const readConfigurationFromDotEnv = (path) => {
	return parse(readFileSync(path));
};

//#endregion
//#region src/utils/read-configuration-from-javascript.ts
const readConfigurationFromJavaScript = (path) => {
	const module = createRequire(import.meta.url)(path);
	if (typeof module === "object" || typeof module === "function") {
		const exported$1 = "default" in module ? module.default : module;
		if (typeof exported$1 === "function") return exported$1(process.env);
		if (isPlainObject(exported$1)) return exported$1;
	}
	throw new Error(`Invalid JS configuration file export type. Requires one of "function", "object", received: "${typeof exported}"`);
};

//#endregion
//#region src/utils/read-configuration-from-json.ts
const readConfigurationFromJson = (path) => {
	const config = createRequire(import.meta.url)(path);
	if (isPlainObject(config) === false) throw new Error("JSON configuration file does not contain an object");
	return config;
};

//#endregion
//#region src/utils/read-configuration-from-yaml.ts
const readConfigurationFromYaml = (path) => {
	const config = requireYaml(path);
	if (isPlainObject(config) === false) throw new Error("YAML configuration file does not contain an object");
	return config;
};

//#endregion
//#region src/lib/read-configuration-from-file.ts
/**
* Read configuration variables from config file
*/
const readConfigurationFromFile = (path) => {
	if (existsSync(path) === false) return null;
	const ext = getFileExtension(path);
	if (isIn(ext, JAVASCRIPT_FILE_EXTS)) return readConfigurationFromJavaScript(path);
	if (ext === "json") return readConfigurationFromJson(path);
	if (isIn(ext, ["yaml", "yml"])) return readConfigurationFromYaml(path);
	return readConfigurationFromDotEnv(path);
};

//#endregion
//#region src/lib/create-env.ts
const createEnv = () => {
	const baseConfiguration = readConfigurationFromProcess();
	const fileConfiguration = readConfigurationFromFile(getConfigPath());
	const rawConfiguration = {
		...baseConfiguration,
		...fileConfiguration
	};
	const output = {};
	for (const [key, value] of Object.entries(DEFAULTS)) output[key] = getDefaultType(key) ? cast(value, key) : value;
	for (let [key, value] of Object.entries(rawConfiguration)) {
		if (isFileKey(key) && isDirectusVariable(key) && typeof value === "string") try {
			const castFlag = getCastFlag(value);
			const castPrefix = castFlag ? castFlag + ":" : "";
			const fileContent = readFileSync(castFlag ? value.replace(castPrefix, "") : value, { encoding: "utf8" });
			key = removeFileSuffix(key);
			value = castPrefix + fileContent;
		} catch {
			throw new Error(`Failed to read value from file "${value}", defined in environment variable "${key}".`);
		}
		output[key] = cast(value, key);
	}
	return output;
};

//#endregion
//#region src/lib/use-env.ts
const _cache = { env: void 0 };
const useEnv = () => {
	if (_cache.env) return _cache.env;
	_cache.env = createEnv();
	return _cache.env;
};

//#endregion
export { useEnv };