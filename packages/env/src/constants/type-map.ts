import type { EnvType } from '../types/env-type.js';

/**
 * Environment variables that we expect to be in a certain type. Will set the default casting of
 * those values
 */
/**
 * Left out on purpose, because a declared type would change what their consumer
 * sees rather than just how it is parsed:
 *
 * - `AUTH_PROVIDERS` — `auth.ts` gates on `!env['AUTH_PROVIDERS']`, and `'array'`
 *   turns the empty default into `[]`, which is truthy.
 * - `CACHE_VALUE_MAX_SIZE`, `ROOT_REDIRECT`, `CORS_ORIGIN`, `IP_CUSTOM_HEADER`,
 *   `FLOWS_ENV_ALLOW_LIST`, `PRESSURE_LIMITER_MAX_MEMORY_RSS`,
 *   `PRESSURE_LIMITER_MAX_MEMORY_HEAP_USED`, `PRESSURE_LIMITER_RETRY_AFTER` —
 *   `false` disables them and any other value configures them, which no single
 *   EnvType covers.
 * - `IP_TRUST_PROXY` — express reads boolean, number, string or list.
 * - `CONFIG_PATH` — read straight off `process.env` before any casting runs.
 */
export const TYPE_MAP: Record<string, EnvType> = {
	HOST: 'string',
	PORT: 'string',

	DB_NAME: 'string',
	DB_USER: 'string',
	DB_PASSWORD: 'string',
	DB_DATABASE: 'string',
	DB_PORT: 'number',

	DB_EXCLUDE_TABLES: 'array',
	DB_BATCH_INSERT_CHUNK_SIZE: 'number',
	DB_MSSQL_TRUST_BATCH_RETURNING: 'boolean',

	DB_CONNECTIONS: 'array',
	DB_BASE_CONNECTION_NAME: 'string',
	DB_BASE_CONNECTION_PRIORITY: 'number',
	DB_PUBLIC_SHARE_CONNECTION_NAME: 'string',
	'DB_CONNECTION_.+_PRIORITY': 'number',
	'DB_CONNECTION_.+_PORT': 'number',
	'DB_CONNECTION_.+_DATABASE': 'string',
	'DB_CONNECTION_.+_USER': 'string',
	'DB_CONNECTION_.+_PASSWORD': 'string',
	'DB_(CONNECTION_.+_)?POOL__(MIN|MAX)': 'number',
	'DB_(CONNECTION_.+_)?POOL__.+_MILLIS': 'number',

	CACHE_ENABLED: 'boolean',
	CACHE_COMPRESSION_ENABLED: 'boolean',
	CACHE_KEY_HASH_ENABLED: 'boolean',
	CACHE_TTL: 'string',
	CACHE_CONTROL_S_MAXAGE: 'number',
	CACHE_NAMESPACE: 'string',
	CACHE_AUTO_PURGE: 'boolean',
	CACHE_AUTO_PURGE_MODE: 'string',
	CACHE_SCOPED_MAX_PINS_PER_COLLECTION: 'number',
	CACHE_SCHEMA: 'boolean',
	CACHE_STORE: 'string',
	CACHE_SKIP_ALLOWED: 'boolean',
	CACHE_AUTO_FLUSH_ON_DEPLOY: 'boolean',
	CACHE_BUILD_ID: 'string',
	CACHE_STATS_ENABLED: 'boolean',
	CACHE_STATS_RETENTION: 'string',
	CACHE_STATS_DRAIN_SCHEDULE: 'string',
	CACHE_STATS_RETENTION_SCHEDULE: 'string',
	CACHE_STATS_MAX_BYTES: 'string',
	CACHE_STATS_MAX_BUFFER: 'number',
	CACHE_STATS_GAP_LOOKBACK: 'string',
	CACHE_STATUS_HEADER: 'string',
	CACHE_TAGS_HEADER: 'string',
	CACHE_PURGED_TAGS_HEADER: 'string',
	CACHE_AUTO_PURGE_IGNORE_LIST: 'array',
	CACHE_VARY_CONTENT_TYPES: 'array',
	CACHE_VARY_REQUEST_HEADERS: 'array',
	CACHE_VARY_REQUEST_HEADERS_EXCLUDED: 'array',
	CACHE_SCHEMA_MAX_ITERATIONS: 'number',
	CACHE_SCHEMA_SYNC_TIMEOUT: 'number',
	CACHE_SCHEMA_FREEZE_ENABLED: 'boolean',

	RATE_LIMITER_CHARGE: 'string',
	RATE_LIMITER_ENABLED: 'boolean',
	RATE_LIMITER_POINTS: 'number',
	RATE_LIMITER_DURATION: 'number',
	RATE_LIMITER_STORE: 'string',
	RATE_LIMITER_GLOBAL_ENABLED: 'boolean',
	RATE_LIMITER_GLOBAL_POINTS: 'number',
	RATE_LIMITER_GLOBAL_DURATION: 'number',
	RATE_LIMITER_REGISTRATION_ENABLED: 'boolean',
	RATE_LIMITER_REGISTRATION_POINTS: 'number',
	RATE_LIMITER_REGISTRATION_DURATION: 'number',

	IMPORT_IP_DENY_LIST: 'array',

	FILE_METADATA_ALLOW_LIST: 'array',

	GRAPHQL_INTROSPECTION: 'boolean',
	GRAPHQL_SCHEMA_GENERATION_MAX_CONCURRENT: 'number',
	GRAPHQL_QUERY_TOKEN_LIMIT: 'number',

	MAX_BATCH_MUTATION: 'number',

	SERVER_SHUTDOWN_TIMEOUT: 'number',

	LOG_HTTP_IGNORE_PATHS: 'array',

	REDIS_ENABLED: 'boolean',

	METRICS_TOKENS: 'array',
	METRICS_SERVICES: 'array',
	METRICS_ENABLED: 'boolean',

	SYSTEM_MCP_ENABLED: 'boolean',
	SYSTEM_MCP_TOOLS: 'array',
	SYSTEM_MCP_ALLOWED_ORIGINS: 'array',

	PROCESSES_REPORT_ENABLED: 'boolean',
	PROCESSES_REPORT_DETAILS: 'array',
	PROCESSES_SERVICE_NAME: 'string',
	PROCESSES_COLLECT_TIMEOUT: 'string',

	PGBOUNCER_REPORT_ENABLED: 'boolean',
	PGBOUNCER_CONNECTIONS: 'array',
	PGBOUNCER_QUERY_TIMEOUT: 'string',
	'PGBOUNCER_.+_ADMIN_HOSTS': 'array',
	'PGBOUNCER_.+_ADMIN_DATABASE': 'string',
	'PGBOUNCER_.+_ADMIN_USER': 'string',
	'PGBOUNCER_.+_ADMIN_PASSWORD': 'string',

	PUBLIC_URL: 'string',

	MAX_PAYLOAD_SIZE: 'string',
	MAX_RELATIONAL_DEPTH: 'number',

	QUERYSTRING_MAX_PARSE_DEPTH: 'number',

	QUERY_LIMIT_DEFAULT: 'number',

	ROBOTS_TXT: 'string',

	TEMP_PATH: 'string',

	STORAGE_LOCATIONS: 'array',
	STORAGE_LOCAL_DRIVER: 'string',
	STORAGE_LOCAL_ROOT: 'string',

	ACCESS_TOKEN_TTL: 'string',

	EMAIL_VERIFICATION_TOKEN_TTL: 'string',
	EMAIL_FROM: 'string',
	EMAIL_VERIFY_SETUP: 'boolean',
	EMAIL_TRANSPORT: 'string',
	EMAIL_SENDMAIL_NEW_LINE: 'string',
	EMAIL_SENDMAIL_PATH: 'string',
	EMAIL_TEMPLATES_PATH: 'string',

	REFRESH_TOKEN_TTL: 'string',
	REFRESH_TOKEN_COOKIE_NAME: 'string',
	REFRESH_TOKEN_COOKIE_SECURE: 'boolean',
	REFRESH_TOKEN_COOKIE_SAME_SITE: 'string',

	SESSION_COOKIE_TTL: 'string',
	SESSION_COOKIE_NAME: 'string',
	SESSION_COOKIE_SECURE: 'boolean',
	SESSION_COOKIE_SAME_SITE: 'string',
	SESSION_REFRESH_GRACE_PERIOD: 'string',

	USER_INVITE_TOKEN_TTL: 'string',

	LOGIN_STALL_TIME: 'number',

	REGISTER_STALL_TIME: 'number',

	CORS_ENABLED: 'boolean',
	CORS_METHODS: 'array',
	CORS_ALLOWED_HEADERS: 'array',
	CORS_EXPOSED_HEADERS: 'array',
	CORS_CREDENTIALS: 'boolean',
	CORS_MAX_AGE: 'number',

	AUTH_DISABLE_DEFAULT: 'boolean',

	PACKAGE_FILE_LOCATION: 'string',

	EXTENSIONS_PATH: 'string',
	EXTENSIONS_MUST_LOAD: 'boolean',
	EXTENSIONS_AUTO_RELOAD: 'boolean',
	EXTENSIONS_SANDBOX_MEMORY: 'number',
	EXTENSIONS_SANDBOX_TIMEOUT: 'number',

	MIGRATIONS_PATH: 'string',

	MARKETPLACE_TRUST: 'string',

	TELEMETRY: 'boolean',
	TELEMETRY_URL: 'string',

	ASSETS_CACHE_TTL: 'string',
	ASSETS_TRANSFORM_MAX_CONCURRENT: 'number',
	ASSETS_TRANSFORM_IMAGE_MAX_DIMENSION: 'number',
	ASSETS_TRANSFORM_MAX_OPERATIONS: 'number',
	ASSETS_TRANSFORM_TIMEOUT: 'string',
	ASSETS_INVALID_IMAGE_SENSITIVITY_LEVEL: 'string',

	SERVE_APP: 'boolean',

	RELATIONAL_BATCH_SIZE: 'number',

	EXPORT_BATCH_SIZE: 'number',

	USERS_ADMIN_ACCESS_LIMIT: 'number',
	USERS_APP_ACCESS_LIMIT: 'number',
	USERS_API_ACCESS_LIMIT: 'number',

	TUS_ENABLED: 'boolean',
	TUS_CHUNK_SIZE: 'string',
	TUS_UPLOAD_EXPIRATION: 'string',

	RETENTION_ENABLED: 'boolean',
	RETENTION_BATCH: 'number',

	ACTIVITY_RETENTION: 'string',

	REVISIONS_RETENTION: 'string',

	FLOW_LOGS_RETENTION: 'string',

	WEBSOCKETS_ENABLED: 'boolean',
	WEBSOCKETS_REST_ENABLED: 'boolean',
	WEBSOCKETS_REST_AUTH: 'string',
	WEBSOCKETS_REST_AUTH_TIMEOUT: 'number',
	WEBSOCKETS_REST_PATH: 'string',
	WEBSOCKETS_GRAPHQL_ENABLED: 'boolean',
	WEBSOCKETS_GRAPHQL_AUTH: 'string',
	WEBSOCKETS_GRAPHQL_AUTH_TIMEOUT: 'number',
	WEBSOCKETS_GRAPHQL_PATH: 'string',
	WEBSOCKETS_HEARTBEAT_ENABLED: 'boolean',
	WEBSOCKETS_HEARTBEAT_PERIOD: 'number',
	WEBSOCKETS_LOGS_ENABLED: 'boolean',
	WEBSOCKETS_LOGS_PATH: 'string',

	FLOWS_RUN_SCRIPT_MAX_MEMORY: 'number',
	FLOWS_RUN_SCRIPT_TIMEOUT: 'number',

	PRESSURE_LIMITER_ENABLED: 'boolean',
	PRESSURE_LIMITER_SAMPLE_INTERVAL: 'number',
	PRESSURE_LIMITER_MAX_EVENT_LOOP_UTILIZATION: 'number',
	PRESSURE_LIMITER_MAX_EVENT_LOOP_DELAY: 'number',

	FILES_MIME_TYPE_ALLOW_LIST: 'array',

	ACCEPT_TERMS: 'boolean',

	DB_SSL__CA_FILE: 'string',

	ADMIN_PASSWORD: 'string',
	ADMIN_TOKEN: 'string',
	KEY: 'string',
	SECRET: 'string',

	METRICS_SCHEDULE: 'string',
	RETENTION_SCHEDULE: 'string',
	TUS_CLEANUP_SCHEDULE: 'string',

	EXTENSIONS_ROLLDOWN: 'boolean',
	EMAIL_SMTP_PASSWORD: 'string',
	REDIS_PASSWORD: 'string',
	'AUTH_.+_BIND_PASSWORD': 'string',
	'STORAGE_.+_SECRET': 'string',
} as const;

export const TYPE_MAP_REGEX: [RegExp, EnvType][] = Object.entries(TYPE_MAP).map(([name, value]) => [
	new RegExp(`^${name}$`),
	value,
]);
