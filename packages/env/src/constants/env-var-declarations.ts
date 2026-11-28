import { DEFAULT_CHUNK_SIZE } from '@directus/constants';
import { resolve } from 'node:path';
import { cwd } from 'node:process';
import type { CoreEnvVarDeclaration } from '../types/env-var-declaration.js';

/**
 * Every variable core reads: its type, its default when it has one, and the
 * values it may take when only some are meant; one without a type has its value
 * guessed. The defaults, the types the loader casts by, the names an extension
 * may not declare and the names read off a `_FILE` are read off this one table
 * and {@link ENV_VAR_PATTERN_DECLARATIONS}, and so is the type of `useEnv()`.
 */
export const ENV_VAR_DECLARATIONS = {
	HOST: { type: 'string', default: '0.0.0.0' },
	PORT: { type: 'string', default: '8055' },

	DB_NAME: { type: 'string' },
	DB_USER: { type: 'string' },
	DB_PASSWORD: { type: 'string' },
	DB_DATABASE: { type: 'string' },
	DB_PORT: { type: 'number' },

	DB_EXCLUDE_TABLES: {
		type: 'string[]',
		default: ['spatial_ref_sys', 'sysdiagrams'],
	},
	DB_BATCH_INSERT_CHUNK_SIZE: { type: 'number' },

	DB_CONNECTIONS: { type: 'string[]' },
	DB_BASE_CONNECTION_NAME: { type: 'string' },
	DB_BASE_CONNECTION_PRIORITY: { type: 'number' },
	DB_PUBLIC_SHARE_CONNECTION_NAME: { type: 'string' },

	CACHE_ENABLED: { type: 'boolean', default: false },
	CACHE_RESPONSE: { type: 'boolean' },
	CACHE_COMPRESSION_ENABLED: { type: 'boolean', default: true },
	CACHE_KEY_HASH_ENABLED: { type: 'boolean', default: true },
	CACHE_TTL: { type: 'string', default: '5m' },
	CACHE_CONTROL_S_MAXAGE: { type: 'number', default: 0 },
	CACHE_NAMESPACE: { type: 'string', default: 'scalabus' },
	CACHE_AUTO_PURGE: { type: 'boolean', default: false },
	CACHE_AUTO_PURGE_MODE: {
		type: 'string',
		default: 'scoped',
		values: ['scoped', 'full'],
	},
	CACHE_SCOPED_MAX_PINS_PER_COLLECTION: { type: 'number', default: 250 },
	CACHE_SCOPED_MAX_QUERY_CASES: { type: 'number', default: 16 },
	CACHE_SCOPED_MAX_ON_DELETE_ROWS: { type: 'number', default: 1000 },
	CACHE_SCOPED_INDEX_SCAN_COUNT: { type: 'number', default: 1000 },
	CACHE_SCOPED_INDEX_TTL_FACTOR: { type: 'number', default: 2 },
	CACHE_SCOPED_PURGE_RETRY_INTERVAL: { type: 'string', default: '1m' },
	CACHE_SCOPED_PURGE_RETRY_MAX_FINGERPRINTS: { type: 'number', default: 100 },
	CACHE_SCOPED_EPOCH_TTL: { type: 'string', default: '24h' },
	CACHE_SCOPED_INDEX_REAP_SCHEDULE: { type: 'string', default: '0 * * * *' },
	CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX: { type: 'string', default: '5m' },
	CACHE_SCHEMA: { type: 'boolean', default: true },
	CACHE_STORE: {
		type: 'string',
		default: 'memory',
		values: ['memory', 'redis'],
	},
	CACHE_REDIS_DB: { type: 'number' },
	CACHE_SKIP_ALLOWED: { type: 'boolean', default: false },
	CACHE_AUTO_FLUSH_ON_DEPLOY: { type: 'boolean', default: true },
	// How long a boot waits on the flush a changed build starts before it listens
	// with the flush still running. The flush walks the whole response cache, and
	// every worker of a deployment waits behind the one doing it.
	CACHE_AUTO_FLUSH_ON_DEPLOY_TIMEOUT: { type: 'string', default: '30s' },
	// How long `directus cache flush` waits before giving up. A command issued
	// while Redis is unreachable waits on the next reconnect, and the retry policy
	// spaces those out — the serverless recipe puts them 15 minutes apart — so
	// without a deadline the deploy step calling it hangs instead of failing.
	CACHE_FLUSH_TIMEOUT: { type: 'string', default: '30s' },
	CACHE_BUILD_ID: { type: 'string' },
	// Opt-in: the cache page + its telemetry writes are off unless explicitly
	// enabled (and only work with CACHE_STORE=redis). When on, growth is bounded
	// by `RETENTION` (cross-dialect daily reap), `MAX_BYTES` (pg-only hard stop)
	// and `MAX_BUFFER` (Redis-buffer stall guard).
	CACHE_STATS_ENABLED: { type: 'boolean', default: false },
	CACHE_STATS_RETENTION: { type: 'string', default: '30d' },
	// every ten seconds
	CACHE_STATS_DRAIN_SCHEDULE: { type: 'string', default: '*/10 * * * * *' },
	// every ten minutes
	CACHE_STATS_RETENTION_SCHEDULE: { type: 'string', default: '*/10 * * * *' },
	CACHE_STATS_MAX_BYTES: { type: 'string', default: '2gb' },
	CACHE_STATS_MAX_BUFFER: { type: 'number', default: 1_000_000 },
	CACHE_STATS_GAP_LOOKBACK: { type: 'string', default: '1h' },
	CACHE_AUDIT_ENABLED: { type: 'boolean', default: true },
	// Unscheduled: a run replays every live entry uncached, a dev/preview cost.
	CACHE_AUDIT_SCHEDULE: { type: 'string', default: '' },
	CACHE_AUDIT_LIMIT: { type: 'number', default: 0 },
	CACHE_AUDIT_MAX_DURATION: { type: 'string', default: '10m' },
	CACHE_AUDIT_IGNORE_PATHS: { type: 'string[]', default: [] },
	CACHE_AUDIT_RETENTION: { type: 'string', default: '30d' },
	CACHE_STATUS_HEADER: { type: 'string' },
	CACHE_TAGS_HEADER: { type: 'string' },
	// Node's fetch refuses a response past 16kb of headers in total, a batch write
	// carries one pin per row and answers with both tag headers. `0` or an
	// unparseable size emits every pin.
	CACHE_TAGS_HEADER_MAX_SIZE: { type: 'string', default: '4kb' },
	CACHE_PURGED_TAGS_HEADER: { type: 'string' },
	QUERY_AUDIT_HEADER: { type: 'string' },
	QUERY_AUDIT_LEVEL: { type: 'string', default: 'counts' },
	// Runs are grouped, then bound values and statements dropped past it, largest
	// entries first:
	// node's fetch refuses a response past 16kb of headers in total.
	QUERY_AUDIT_HEADER_MAX_SIZE: { type: 'string', default: '8kb' },
	CACHE_AUTO_PURGE_IGNORE_LIST: {
		type: 'string[]',
		default: ['directus_activity', 'directus_presets'],
	},
	// Default on for the formats a cached endpoint might content-negotiate. Safe
	// because browsers/SDKs collapse to json (only an explicit text/csv etc. gets
	// its own bucket). Deliberately NOT xml/html: browsers send them high-q in
	// Accept, so req.accepts would route ALL browser traffic to that bucket and
	// split it from api-client json — fragmenting every install, even non-xml ones.
	CACHE_VARY_CONTENT_TYPES: { type: 'string[]', default: ['json', 'csv', 'yaml'] },
	CACHE_VARY_REQUEST_HEADERS: { type: 'string[]', default: [] },
	// Extra request headers a glob must never fold, on top of the built-in
	// proxy/CDN/tracing denylist (x-forwarded-*, cf-*, x-envoy-*, …). Add
	// platform-specific per-request headers here; globs allowed.
	CACHE_VARY_REQUEST_HEADERS_EXCLUDED: { type: 'string[]', default: [] },
	CACHE_SCHEMA_MAX_ITERATIONS: { type: 'number', default: 100 },
	CACHE_SCHEMA_SYNC_TIMEOUT: { type: 'number', default: 10000 },
	CACHE_SCHEMA_FREEZE_ENABLED: { type: 'boolean', default: false },

	RATE_LIMITER_CHARGE: { type: 'string', default: 'cache-misses' },
	RATE_LIMITER_ENABLED: { type: 'boolean', default: false },
	RATE_LIMITER_POINTS: { type: 'number', default: 50 },
	RATE_LIMITER_DURATION: { type: 'number', default: 1 },
	RATE_LIMITER_STORE: {
		type: 'string',
		default: 'memory',
		values: ['memory', 'redis'],
	},
	RATE_LIMITER_GLOBAL_ENABLED: { type: 'boolean', default: false },
	RATE_LIMITER_GLOBAL_POINTS: { type: 'number', default: 1000 },
	RATE_LIMITER_GLOBAL_DURATION: { type: 'number', default: 1 },
	RATE_LIMITER_REGISTRATION_ENABLED: { type: 'boolean', default: true },
	RATE_LIMITER_REGISTRATION_POINTS: { type: 'number', default: 5 },
	RATE_LIMITER_REGISTRATION_DURATION: { type: 'number', default: 60 },

	IMPORT_IP_DENY_LIST: { type: 'string[]', default: ['0.0.0.0', '169.254.169.254'] },

	FILE_METADATA_ALLOW_LIST: {
		type: 'string[]',
		default: [
			'ifd0.Make',
			'ifd0.Model',
			'exif.FNumber',
			'exif.ExposureTime',
			'exif.FocalLength',
			'exif.ISOSpeedRatings',
		],
	},

	GRAPHQL_INTROSPECTION: { type: 'boolean', default: true },
	GRAPHQL_SCHEMA_GENERATION_MAX_CONCURRENT: { type: 'number', default: 5 },
	GRAPHQL_QUERY_TOKEN_LIMIT: { type: 'number', default: 5000 },

	MAX_BATCH_MUTATION: { type: 'number', default: Infinity },
	DEFAULT_MUTATION_BATCHING: { type: 'string', default: 'preserveMutationOrder' },

	SERVER_SHUTDOWN_TIMEOUT: { type: 'number', default: 1000 },

	LOG_HTTP_IGNORE_PATHS: { type: 'string[]' },

	REDIS_ENABLED: { type: 'boolean' },
	REDIS_MAX_RETRIES_PER_REQUEST: { type: 'number' },
	REDIS_RETRY_BASE_DELAY: { type: 'number' },
	REDIS_RETRY_MAX_DELAY: { type: 'number' },
	REDIS_RETRY_MAX_ATTEMPTS: { type: 'number' },

	BUS_NAMESPACE: { type: 'string' },

	METRICS_TOKENS: { type: 'string[]' },
	METRICS_SERVICES: {
		type: 'string[]',
		default: ['database', 'cache', 'redis', 'storage'],
	},
	METRICS_ENABLED: { type: 'boolean', default: false },

	SYSTEM_MCP_ENABLED: { type: 'boolean', default: false },
	SYSTEM_MCP_TOOLS: { type: 'string[]', default: ['processes', 'cache'] },
	SYSTEM_MCP_ALLOWED_ORIGINS: { type: 'string[]', default: [] },

	PROCESSES_REPORT_ENABLED: { type: 'boolean', default: true },
	PROCESSES_REPORT_DETAILS: { type: 'string[]', default: ['stats', 'env'] },
	PROCESSES_SERVICE_NAME: { type: 'string' },
	PROCESSES_COLLECT_TIMEOUT: { type: 'string', default: '750ms' },

	PM2_HOME: { type: 'string' },
	PM2_INSTANCES: { type: 'number' },
	PM2_EXEC_MODE: { type: 'string' },
	PM2_MAX_MEMORY_RESTART: { type: 'string' },
	PM2_MIN_UPTIME: { type: 'number' },
	PM2_LISTEN_TIMEOUT: { type: 'number' },
	PM2_KILL_TIMEOUT: { type: 'number' },
	PM2_MAX_RESTARTS: { type: 'number' },
	PM2_RESTART_DELAY: { type: 'number' },
	PM2_AUTO_RESTART: { type: 'string' },
	PM2_LOG_ERROR_FILE: { type: 'string' },
	PM2_LOG_OUT_FILE: { type: 'string' },

	PM2_AUTOSCALE_ENABLED: { type: 'boolean' },
	PM2_AUTOSCALE_APP_NAME: { type: 'string' },
	PM2_AUTOSCALE_SIGNAL: { type: 'string' },
	PM2_AUTOSCALE_STRATEGY: { type: 'string' },
	PM2_AUTOSCALE_SAMPLE_WINDOW: { type: 'number' },
	PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: { type: 'number' },
	PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: { type: 'number' },
	PM2_AUTOSCALE_MIN_WORKERS: { type: 'number' },
	PM2_AUTOSCALE_MAX_WORKERS: { type: 'number' },
	PM2_AUTOSCALE_PREWARM: { type: 'number' },
	PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER: { type: 'number' },
	PM2_AUTOSCALE_MIN_SECONDS_TO_RELEASE_WORKER: { type: 'number' },
	PM2_AUTOSCALE_WARMUP_SECONDS: { type: 'number' },
	PM2_AUTOSCALE_DRILL_ENABLED: { type: 'boolean' },
	PM2_POOL_HEALTH_REFRESH: { type: 'string' },

	SHARED_SETTINGS_POLL_SECONDS: { type: 'number' },

	PGBOUNCER_REPORT_ENABLED: { type: 'boolean', default: false },
	PGBOUNCER_CONNECTIONS: { type: 'string[]', default: [] },
	PGBOUNCER_QUERY_TIMEOUT: { type: 'string', default: '2s' },

	MIGRATIONS_WAIT_TIMEOUT: { type: 'string', default: '5m' },
	MIGRATIONS_WAIT_INTERVAL: { type: 'string', default: '2s' },

	PUBLIC_URL: { type: 'string', default: '/' },

	MAX_PAYLOAD_SIZE: { type: 'string', default: '1mb' },
	MAX_RELATIONAL_DEPTH: { type: 'number', default: 10 },

	QUERYSTRING_MAX_PARSE_DEPTH: { type: 'number', default: 10 },

	QUERY_LIMIT_DEFAULT: { type: 'number', default: 100 },

	ROBOTS_TXT: { type: 'string', default: 'User-agent: *\nDisallow: /' },

	TEMP_PATH: { type: 'string', default: './node_modules/.directus' },

	STORAGE_LOCATIONS: { type: 'string[]', default: ['local'] },
	STORAGE_LOCAL_DRIVER: { type: 'string', default: 'local' },
	STORAGE_LOCAL_ROOT: { type: 'string', default: './uploads' },

	ACCESS_TOKEN_TTL: { type: 'string', default: '15m' },

	EMAIL_VERIFICATION_TOKEN_TTL: { type: 'string', default: '7d' },
	EMAIL_FROM: { type: 'string', default: 'no-reply@example.com' },
	EMAIL_VERIFY_SETUP: { type: 'boolean', default: true },
	EMAIL_TRANSPORT: { type: 'string', default: 'sendmail' },
	EMAIL_SENDMAIL_NEW_LINE: { type: 'string', default: 'unix' },
	EMAIL_SENDMAIL_PATH: { type: 'string', default: '/usr/sbin/sendmail' },
	EMAIL_TEMPLATES_PATH: { type: 'string', default: './templates' },

	REFRESH_TOKEN_TTL: { type: 'string', default: '7d' },
	REFRESH_TOKEN_COOKIE_NAME: { type: 'string', default: 'directus_refresh_token' },
	REFRESH_TOKEN_COOKIE_SECURE: { type: 'boolean', default: false },
	REFRESH_TOKEN_COOKIE_SAME_SITE: { type: 'string', default: 'lax' },

	SESSION_COOKIE_TTL: { type: 'string', default: '1d' },
	SESSION_COOKIE_NAME: { type: 'string', default: 'directus_session_token' },
	SESSION_COOKIE_SECURE: { type: 'boolean', default: false },
	SESSION_COOKIE_SAME_SITE: { type: 'string', default: 'lax' },
	SESSION_REFRESH_GRACE_PERIOD: { type: 'string', default: '10s' },

	USER_INVITE_TOKEN_TTL: { type: 'string', default: '7d' },

	LOGIN_STALL_TIME: { type: 'number', default: 500 },

	REGISTER_STALL_TIME: { type: 'number', default: 750 },

	CORS_ENABLED: { type: 'boolean', default: false },
	CORS_METHODS: { type: 'string[]', default: ['GET', 'POST', 'PATCH', 'DELETE'] },
	CORS_ALLOWED_HEADERS: {
		type: 'string[]',
		default: ['Content-Type', 'Authorization'],
	},
	CORS_EXPOSED_HEADERS: { type: 'string[]', default: ['Content-Range'] },
	CORS_CREDENTIALS: { type: 'boolean', default: true },
	CORS_MAX_AGE: { type: 'number', default: 18000 },

	AUTH_DISABLE_DEFAULT: { type: 'boolean', default: false },

	PACKAGE_FILE_LOCATION: { type: 'string', default: '.' },

	EXTENSIONS_MUST_LOAD: { type: 'boolean', default: false },
	EXTENSIONS_AUTO_RELOAD: { type: 'boolean', default: false },
	EXTENSIONS_AUTO_MIGRATE: { type: 'boolean', default: false },
	EXTENSIONS_SANDBOX_MEMORY: { type: 'number', default: 100 },
	EXTENSIONS_SANDBOX_TIMEOUT: { type: 'number', default: 1000 },

	MIGRATIONS_PATH: { type: 'string', default: './migrations' },
	MIGRATIONS_STATEMENT_TIMEOUT: { type: 'string', default: '0' },
	MIGRATIONS_LOCK_TIMEOUT: { type: 'string', default: '10s' },
	MIGRATIONS_IDLE_IN_TRANSACTION_SESSION_TIMEOUT: { type: 'string', default: '0' },

	MARKETPLACE_ENABLED: { type: 'boolean', default: false },
	MARKETPLACE_TRUST: { type: 'string', default: 'sandbox' },

	OUT_OF_SCOPE_FEATURES_ALLOWED: { type: 'string[]', default: [] },

	TELEMETRY: { type: 'boolean', default: false },
	TELEMETRY_URL: { type: 'string', default: 'https://telemetry.directus.io' },

	ASSETS_CACHE_TTL: { type: 'string', default: '30d' },
	ASSETS_TRANSFORM_MAX_CONCURRENT: { type: 'number', default: 25 },
	ASSETS_TRANSFORM_IMAGE_MAX_DIMENSION: { type: 'number', default: 6000 },
	ASSETS_TRANSFORM_MAX_OPERATIONS: { type: 'number', default: 5 },
	ASSETS_TRANSFORM_TIMEOUT: { type: 'string', default: '7500ms' },
	ASSETS_INVALID_IMAGE_SENSITIVITY_LEVEL: { type: 'string', default: 'warning' },

	SERVE_APP: { type: 'boolean', default: true },

	RELATIONAL_BATCH_SIZE: { type: 'number', default: 25000 },

	EXPORT_BATCH_SIZE: { type: 'number', default: 5000 },

	USERS_ADMIN_ACCESS_LIMIT: { type: 'number', default: Infinity },
	USERS_APP_ACCESS_LIMIT: { type: 'number', default: Infinity },
	USERS_API_ACCESS_LIMIT: { type: 'number', default: Infinity },

	TUS_ENABLED: { type: 'boolean', default: false },
	TUS_CHUNK_SIZE: { type: 'string', default: String(DEFAULT_CHUNK_SIZE) }, // 8mb
	TUS_UPLOAD_EXPIRATION: { type: 'string', default: '10m' },

	RETENTION_ENABLED: { type: 'boolean', default: false },
	RETENTION_BATCH: { type: 'number', default: 500 },

	ACTIVITY_RETENTION: { type: 'string', default: '90d' },

	REVISIONS_RETENTION: { type: 'string', default: '90d' },

	FLOW_LOGS_RETENTION: { type: 'string', default: '90d' },

	WEBSOCKETS_ENABLED: { type: 'boolean', default: false },
	WEBSOCKETS_REST_ENABLED: { type: 'boolean', default: true },
	WEBSOCKETS_REST_AUTH: { type: 'string', default: 'handshake' },
	WEBSOCKETS_REST_AUTH_TIMEOUT: { type: 'number', default: 10 },
	WEBSOCKETS_REST_PATH: { type: 'string', default: '/websocket' },
	WEBSOCKETS_GRAPHQL_ENABLED: { type: 'boolean', default: false },
	WEBSOCKETS_GRAPHQL_AUTH: { type: 'string', default: 'handshake' },
	WEBSOCKETS_GRAPHQL_AUTH_TIMEOUT: { type: 'number', default: 10 },
	WEBSOCKETS_GRAPHQL_PATH: { type: 'string', default: '/graphql' },
	WEBSOCKETS_HEARTBEAT_ENABLED: { type: 'boolean', default: true },
	WEBSOCKETS_HEARTBEAT_PERIOD: { type: 'number', default: 30 },
	WEBSOCKETS_LOGS_ENABLED: { type: 'boolean', default: true },
	WEBSOCKETS_LOGS_PATH: { type: 'string', default: '/websocket/logs' },

	FLOWS_RUN_SCRIPT_MAX_MEMORY: { type: 'number', default: 32 },
	FLOWS_RUN_SCRIPT_TIMEOUT: { type: 'number', default: 10000 },

	PRESSURE_LIMITER_ENABLED: { type: 'boolean', default: true },
	PRESSURE_LIMITER_SAMPLE_INTERVAL: { type: 'number', default: 250 },
	PRESSURE_LIMITER_MAX_EVENT_LOOP_UTILIZATION: { type: 'number', default: 0.99 },
	PRESSURE_LIMITER_MAX_EVENT_LOOP_DELAY: { type: 'number', default: 500 },

	FILES_MIME_TYPE_ALLOW_LIST: { type: 'string[]', default: ['*/*'] },

	ACCEPT_TERMS: { type: 'boolean', default: false },

	DB_SSL__CA_FILE: { type: 'string' },

	ADMIN_PASSWORD: { type: 'string' },
	ADMIN_TOKEN: { type: 'string' },
	KEY: { type: 'string' },
	SECRET: { type: 'string' },

	METRICS_SCHEDULE: { type: 'string', default: '*/1 * * * *' },
	RETENTION_SCHEDULE: { type: 'string', default: '0 0 * * *' }, // once a day at 12AM
	TUS_CLEANUP_SCHEDULE: { type: 'string', default: '0 * * * *' }, // every hour

	EXTENSIONS_ROLLDOWN: { type: 'boolean', default: false },
	EMAIL_SMTP_PASSWORD: { type: 'string' },
	REDIS_PASSWORD: { type: 'string' },

	// `auth.ts` walks the list, so the empty default casts to `[]`: none.
	AUTH_PROVIDERS: { type: 'string[]', default: [] },
	// Read straight off `process.env` before any casting runs.
	CONFIG_PATH: { type: 'string', default: resolve(cwd(), '.env') },

	// `false` disables them; any other value is of the type after `false |`.
	ROOT_REDIRECT: { type: 'false | string', default: './admin' },
	// `respond.ts` keys off `!== false`; any other value is a size like `8kb`.
	CACHE_VALUE_MAX_SIZE: { type: 'false | string', default: false },
	IP_CUSTOM_HEADER: { type: 'false | string', default: false },
	FLOWS_ENV_ALLOW_LIST: { type: 'false | string[]', default: false },
	PRESSURE_LIMITER_MAX_MEMORY_RSS: { type: 'false | number', default: false },
	PRESSURE_LIMITER_MAX_MEMORY_HEAP_USED: {
		type: 'false | number',
		default: false,
	},
	// The `Retry-After` header, as written.
	PRESSURE_LIMITER_RETRY_AFTER: { type: 'false | string', default: false },
	// Unset keeps node-redis's 5000ms probe; a number spaces it in ms.
	REDIS_KEEP_ALIVE: { type: 'false | number' },
	// express and cors read a boolean, a hop count, an address or a list:
	// `CORS_ORIGIN=*` stays the string cors matches every origin with.
	CORS_ORIGIN: {
		type: 'boolean | number | string | string[]',
		default: false,
	},
	IP_TRUST_PROXY: {
		type: 'boolean | number | string | string[]',
		default: true,
	},

	ADMIN_EMAIL: { type: 'string' },
	CACHE_HEALTHCHECK_THRESHOLD: { type: 'number' },
	CACHE_SYSTEM_TTL: { type: 'string' },
	EMAIL_MAILGUN_API_KEY: { type: 'string' },
	EMAIL_MAILGUN_DOMAIN: { type: 'string' },
	EMAIL_MAILGUN_HOST: { type: 'string' },
	EMAIL_SES_CREDENTIALS__ACCESS_KEY_ID: { type: 'string' },
	EMAIL_SES_CREDENTIALS__SECRET_ACCESS_KEY: { type: 'string' },
	EMAIL_SES_REGION: { type: 'string' },
	EMAIL_SMTP_HOST: { type: 'string' },
	EMAIL_SMTP_IGNORE_TLS: { type: 'boolean' },
	EMAIL_SMTP_NAME: { type: 'string' },
	EMAIL_SMTP_POOL: { type: 'boolean' },
	EMAIL_SMTP_PORT: { type: 'number' },
	EMAIL_SMTP_SECURE: { type: 'boolean' },
	EMAIL_SMTP_USER: { type: 'string' },
	EXTENSIONS_CACHE_TTL: { type: 'string' },
	EXTENSIONS_LIMIT: { type: 'number' },
	EXTENSIONS_LOCATION: { type: 'string' },
	// Read only to refuse it: this build no longer does.
	EXTENSIONS_PATH: { type: 'string' },
	FILES_CONTENT_TYPE_ALLOW_LIST: { type: 'string[]' },
	FILES_MAX_UPLOAD_SIZE: { type: 'string' },
	GRAPHQL_SCHEMA_CACHE_CAPACITY: { type: 'number' },
	LOG_LEVEL: { type: 'string' },
	LOG_STYLE: { type: 'string' },
	MARKETPLACE_REGISTRY: { type: 'string' },
	PASSWORD_RESET_URL_ALLOW_LIST: { type: 'string[]' },
	PROJECT_NAME: { type: 'string' },
	QUERY_LIMIT_MAX: { type: 'number' },
	REDIS: { type: 'string' },
	REDIS_DB: { type: 'number' },
	REDIS_HOST: { type: 'string' },
	REDIS_PORT: { type: 'number' },
	REDIS_USERNAME: { type: 'string' },
	REFRESH_TOKEN_COOKIE_DOMAIN: { type: 'string' },
	SESSION_COOKIE_DOMAIN: { type: 'string' },
	SYNCHRONIZATION_NAMESPACE: { type: 'string' },
	SYNCHRONIZATION_STORE: { type: 'string' },
	TELEMETRY_AUTHORIZATION: { type: 'string' },
	UNIX_SOCKET_PATH: { type: 'string' },
	USER_INVITE_URL_ALLOW_LIST: { type: 'string[]' },
	USER_REGISTER_URL_ALLOW_LIST: { type: 'string[]' },
	WEBSOCKETS_LOGS_LEVEL: { type: 'string' },
	WEBSOCKETS_LOGS_STYLE: { type: 'string' },

	// Set by the platform or the process manager, read by core.
	NODE_ENV: { type: 'string' },
	RAILWAY_GIT_COMMIT_SHA: { type: 'string' },
	RAILWAY_REPLICA_ID: { type: 'string' },
	RAILWAY_SERVICE_NAME: { type: 'string' },
	name: { type: 'string' },

	// Read off DB_ by knex and its drivers (pg, mysql2, sqlite3), camelCased.
	DB_CLIENT: { type: 'string' },
	DB_VERSION: { type: 'string' },
	DB_HOST: { type: 'string' },
	DB_FILENAME: { type: 'string' },
	DB_CONNECTION_STRING: { type: 'string' },
	DB_SEARCH_PATH: { type: 'string[]' },
	DB_APPLICATION_NAME: { type: 'string' },
	DB_HEALTHCHECK_THRESHOLD: { type: 'number' },
	DB_KEEP_ALIVE: { type: 'boolean' },
	DB_KEEP_ALIVE_INITIAL_DELAY_MILLIS: { type: 'number' },
	DB_CONNECTION_TIMEOUT_MILLIS: { type: 'number' },
	DB_OPTIONS: { type: 'string' },
	DB_CHARSET: { type: 'string' },
	DB_TIMEZONE: { type: 'string' },
	DB_CONNECT_TIMEOUT: { type: 'number' },
	DB_SOCKET_PATH: { type: 'string' },
	DB_SUPPORT_BIG_NUMBERS: { type: 'boolean' },
	DB_BIG_NUMBER_STRINGS: { type: 'boolean' },
	DB_DATE_STRINGS: { type: 'boolean' },
	DB_DECIMAL_NUMBERS: { type: 'boolean' },
	DB_POOL__PROPAGATE_CREATE_ERROR: { type: 'boolean' },
	// true for pg; its tls options go under DB_SSL__.
	// TODO(#610): mysql2 also takes an ssl profile name here.
	DB_SSL: { type: 'boolean' },
	// Read off LOGGER_ by pino, LOGGER_HTTP by pino-http, camelCased.
	LOGGER_LEVELS: { type: 'string[]' },
	LOGGER_LEVEL: { type: 'string' },
	LOGGER_NAME: { type: 'string' },
	LOGGER_ENABLED: { type: 'boolean' },
	LOGGER_TIMESTAMP: { type: 'boolean' },
	LOGGER_MESSAGE_KEY: { type: 'string' },
	LOGGER_ERROR_KEY: { type: 'string' },
	LOGGER_NESTED_KEY: { type: 'string' },
	LOGGER_MSG_PREFIX: { type: 'string' },
	LOGGER_CRLF: { type: 'boolean' },
	LOGGER_DEPTH_LIMIT: { type: 'number' },
	LOGGER_EDGE_LIMIT: { type: 'number' },
	LOGGER_HTTP_USE_LEVEL: { type: 'string' },
	LOGGER_HTTP_QUIET_REQ_LOGGER: { type: 'boolean' },
	LOGGER_HTTP_QUIET_RES_LOGGER: { type: 'boolean' },
	LOGGER_HTTP_WRAP_SERIALIZERS: { type: 'boolean' },
	// Assigned onto the http server by SERVER_.
	SERVER_KEEP_ALIVE_TIMEOUT: { type: 'number' },
	SERVER_HEADERS_TIMEOUT: { type: 'number' },
	SERVER_REQUEST_TIMEOUT: { type: 'number' },
	SERVER_TIMEOUT: { type: 'number' },
	SERVER_MAX_HEADERS_COUNT: { type: 'number' },
	SERVER_MAX_REQUESTS_PER_SOCKET: { type: 'number' },
	// Read off HASH_ by argon2; HASH_RAW is never read.
	HASH_MEMORY_COST: { type: 'number' },
	HASH_TIME_COST: { type: 'number' },
	HASH_PARALLELISM: { type: 'number' },
	HASH_HASH_LENGTH: { type: 'number' },
	HASH_SALT_LENGTH: { type: 'number' },
	HASH_TYPE: { type: 'number' },
	// argon2 takes a Buffer, made from this string.
	HASH_ASSOCIATED_DATA: { type: 'string' },
	// Read off HSTS_ and the two CSP prefixes by helmet.
	HSTS_ENABLED: { type: 'boolean' },
	HSTS_MAX_AGE: { type: 'number' },
	HSTS_INCLUDE_SUB_DOMAINS: { type: 'boolean' },
	HSTS_PRELOAD: { type: 'boolean' },
	CONTENT_SECURITY_POLICY_USE_DEFAULTS: { type: 'boolean' },
	CONTENT_SECURITY_POLICY_REPORT_ONLY: { type: 'boolean' },
	ASSETS_CONTENT_SECURITY_POLICY_USE_DEFAULTS: { type: 'boolean' },
	ASSETS_CONTENT_SECURITY_POLICY_REPORT_ONLY: { type: 'boolean' },
	// Read off RATE_LIMITER_ and its GLOBAL_ and REGISTRATION_ limiters.
	RATE_LIMITER_HEALTHCHECK_THRESHOLD: { type: 'number' },
	RATE_LIMITER_GLOBAL_HEALTHCHECK_THRESHOLD: { type: 'number' },
	RATE_LIMITER_KEY_PREFIX: { type: 'string' },
	RATE_LIMITER_BLOCK_DURATION: { type: 'number' },
	RATE_LIMITER_EXEC_EVENLY: { type: 'boolean' },
	RATE_LIMITER_EXEC_EVENLY_MIN_DELAY_MS: { type: 'number' },
	RATE_LIMITER_IN_MEMORY_BLOCK_ON_CONSUMED: { type: 'number' },
	RATE_LIMITER_IN_MEMORY_BLOCK_DURATION: { type: 'number' },
	RATE_LIMITER_GLOBAL_KEY_PREFIX: { type: 'string' },
	RATE_LIMITER_GLOBAL_BLOCK_DURATION: { type: 'number' },
	RATE_LIMITER_GLOBAL_EXEC_EVENLY: { type: 'boolean' },
	RATE_LIMITER_GLOBAL_EXEC_EVENLY_MIN_DELAY_MS: { type: 'number' },
	RATE_LIMITER_GLOBAL_IN_MEMORY_BLOCK_ON_CONSUMED: { type: 'number' },
	RATE_LIMITER_GLOBAL_IN_MEMORY_BLOCK_DURATION: { type: 'number' },
	RATE_LIMITER_REGISTRATION_KEY_PREFIX: { type: 'string' },
	RATE_LIMITER_REGISTRATION_BLOCK_DURATION: { type: 'number' },
	RATE_LIMITER_REGISTRATION_EXEC_EVENLY: { type: 'boolean' },
	RATE_LIMITER_REGISTRATION_EXEC_EVENLY_MIN_DELAY_MS: { type: 'number' },
	RATE_LIMITER_REGISTRATION_IN_MEMORY_BLOCK_ON_CONSUMED: { type: 'number' },
	RATE_LIMITER_REGISTRATION_IN_MEMORY_BLOCK_DURATION: { type: 'number' },
} as const satisfies Record<string, CoreEnvVarDeclaration>;

/**
 * The variables of a named connection, location or provider, whose names hold
 * a part the deployment chooses: keyed by the glob of the name, each `*` one or
 * more characters. The first glob a name matches declares it, so the typed ones
 * come before the guessed, and the passthroughs a library reads last.
 */
export const ENV_VAR_PATTERN_DECLARATIONS = {
	'DB_CONNECTION_*_PRIORITY': { type: 'number' },
	'DB_CONNECTION_*_PORT': { type: 'number' },
	'DB_CONNECTION_*_DATABASE': { type: 'string' },
	'DB_CONNECTION_*_USER': { type: 'string' },
	'DB_CONNECTION_*_PASSWORD': { type: 'string' },
	'DB_POOL__MIN': { type: 'number' },
	'DB_POOL__MAX': { type: 'number' },
	'DB_CONNECTION_*_POOL__MIN': { type: 'number' },
	'DB_CONNECTION_*_POOL__MAX': { type: 'number' },
	'DB_POOL__*_MILLIS': { type: 'number' },
	'DB_CONNECTION_*_POOL__*_MILLIS': { type: 'number' },
	'PGBOUNCER_*_ADMIN_HOSTS': { type: 'string[]' },
	'PGBOUNCER_*_ADMIN_DATABASE': { type: 'string' },
	'PGBOUNCER_*_ADMIN_USER': { type: 'string' },
	'PGBOUNCER_*_ADMIN_PASSWORD': { type: 'string' },
	'AUTH_*_BIND_PASSWORD': { type: 'string' },
	'STORAGE_*_SECRET': { type: 'string' },

	'WEBSOCKETS_*_ENABLED': { type: 'boolean' },
	'WEBSOCKETS_*_PATH': { type: 'string' },
	'WEBSOCKETS_*_AUTH': { type: 'string' },
	'WEBSOCKETS_*_AUTH_TIMEOUT': { type: 'number' },
	'WEBSOCKETS_*_CONN_LIMIT': { type: 'number' },

	'STORAGE_*_DRIVER': { type: 'string' },
	'STORAGE_*_ROOT': { type: 'string' },
	'STORAGE_*_KEY': { type: 'string' },
	'STORAGE_*_BUCKET': { type: 'string' },
	'STORAGE_*_REGION': { type: 'string' },
	'STORAGE_*_ENDPOINT': { type: 'string' },
	'STORAGE_*_ACL': { type: 'string' },
	'STORAGE_*_CONTAINER_NAME': { type: 'string' },
	'STORAGE_*_SERVER_SIDE_ENCRYPTION': { type: 'string' },
	'STORAGE_*_ACCOUNT_NAME': { type: 'string' },
	'STORAGE_*_ACCOUNT_KEY': { type: 'string' },
	'STORAGE_*_KEY_FILENAME': { type: 'string' },
	'STORAGE_*_FORCE_PATH_STYLE': { type: 'boolean' },
	'STORAGE_*_HEALTHCHECK_THRESHOLD': { type: 'number' },

	'AUTH_*_DRIVER': { type: 'string' },
	'AUTH_*_MODE': { type: 'string' },
	// jwt.sign reads a number as seconds, a string as a duration.
	'AUTH_*_LOGIN_TIMEOUT': { type: 'number | string' },
	'AUTH_*_CLIENT_ID': { type: 'string' },
	'AUTH_*_CLIENT_SECRET': { type: 'string' },
	'AUTH_*_CLIENT_PRIVATE_KEYS': { type: 'json' },
	'AUTH_*_CLIENT_TOKEN_ENDPOINT_AUTH_METHOD': { type: 'string' },
	'AUTH_*_CLIENT__*': {},
	'AUTH_*_SCOPE': { type: 'string' },
	'AUTH_*_AUTHORIZE_URL': { type: 'string' },
	'AUTH_*_ACCESS_URL': { type: 'string' },
	'AUTH_*_PROFILE_URL': { type: 'string' },
	'AUTH_*_IDENTIFIER_KEY': { type: 'string' },
	'AUTH_*_EMAIL_KEY': { type: 'string' },
	'AUTH_*_FIRST_NAME_KEY': { type: 'string' },
	'AUTH_*_LAST_NAME_KEY': { type: 'string' },
	'AUTH_*_ALLOW_PUBLIC_REGISTRATION': { type: 'boolean' },
	'AUTH_*_DEFAULT_ROLE_ID': { type: 'string' },
	'AUTH_*_SYNC_USER_INFO': { type: 'boolean' },
	'AUTH_*_ICON': { type: 'string' },
	'AUTH_*_LABEL': { type: 'string' },
	'AUTH_*_PARAMS': { type: 'json' },
	'AUTH_*_ISSUER_URL': { type: 'string' },
	'AUTH_*_ISSUER_DISCOVERY_MUST_SUCCEED': { type: 'boolean' },
	// The keys of openid-client's HttpOptions, typed off its .d.ts; agent and
	// lookup are functions. The glob after them still guesses any other.
	'AUTH_*_CLIENT_HTTP_CA': { type: 'string' },
	'AUTH_*_CLIENT_HTTP_CERT': { type: 'string' },
	'AUTH_*_CLIENT_HTTP_CRL': { type: 'string' },
	'AUTH_*_CLIENT_HTTP_KEY': { type: 'string' },
	'AUTH_*_CLIENT_HTTP_PASSPHRASE': { type: 'string' },
	'AUTH_*_CLIENT_HTTP_PFX': { type: 'string' },
	'AUTH_*_CLIENT_HTTP_TIMEOUT': { type: 'number' },
	'AUTH_*_CLIENT_HTTP_*': {},
	'AUTH_*_REQUIRE_VERIFIED_EMAIL': { type: 'boolean' },
	'AUTH_*_PLAIN_CODE_CHALLENGE': { type: 'boolean' },
	'AUTH_*_GROUP_CLAIM_NAME': { type: 'string' },
	'AUTH_*_ROLE_MAPPING': { type: 'json' },
	'AUTH_*_GIVEN_NAME_KEY': { type: 'string' },
	'AUTH_*_FAMILY_NAME_KEY': { type: 'string' },
	'AUTH_*_CLIENT_URL': { type: 'string' },
	'AUTH_*_BIND_DN': { type: 'string' },
	'AUTH_*_USER_DN': { type: 'string' },
	'AUTH_*_USER_ATTRIBUTE': { type: 'string' },
	'AUTH_*_USER_SCOPE': { type: 'string' },
	'AUTH_*_MAIL_ATTRIBUTE': { type: 'string' },
	'AUTH_*_FIRST_NAME_ATTRIBUTE': { type: 'string' },
	'AUTH_*_LAST_NAME_ATTRIBUTE': { type: 'string' },
	'AUTH_*_GROUP_DN': { type: 'string' },
	'AUTH_*_GROUP_ATTRIBUTE': { type: 'string' },
	'AUTH_*_GROUP_SCOPE': { type: 'string' },
	// samlify's IdentityProviderSettings and ServiceProviderSettings keys, typed
	// off its .d.ts; templates, services, ids and functions are left guessed.
	'AUTH_*_IDP_METADATA': { type: 'string' },
	'AUTH_*_IDP_REQUEST_SIGNATURE_ALGORITHM': { type: 'string' },
	'AUTH_*_IDP_PRIVATE_KEY': { type: 'string' },
	'AUTH_*_IDP_PRIVATE_KEY_PASS': { type: 'string' },
	'AUTH_*_IDP_SIGNING_CERT': { type: 'string' },
	'AUTH_*_IDP_ENCRYPT_CERT': { type: 'string' },
	'AUTH_*_IDP_ENC_PRIVATE_KEY': { type: 'string' },
	'AUTH_*_IDP_ENC_PRIVATE_KEY_PASS': { type: 'string' },
	'AUTH_*_IDP_MESSAGE_SIGNING_ORDER': { type: 'string' },
	'AUTH_*_IDP_IS_ASSERTION_ENCRYPTED': { type: 'boolean' },
	'AUTH_*_IDP_WANT_LOGOUT_REQUEST_SIGNED': { type: 'boolean' },
	'AUTH_*_IDP_WANT_LOGOUT_RESPONSE_SIGNED': { type: 'boolean' },
	'AUTH_*_IDP_WANT_AUTHN_REQUESTS_SIGNED': { type: 'boolean' },
	'AUTH_*_IDP_WANT_LOGOUT_REQUEST_SIGNED_RESPONSE_SIGNED': { type: 'boolean' },
	'AUTH_*_SP_METADATA': { type: 'string' },
	'AUTH_*_SP_PRIVATE_KEY': { type: 'string' },
	'AUTH_*_SP_PRIVATE_KEY_PASS': { type: 'string' },
	'AUTH_*_SP_REQUEST_SIGNATURE_ALGORITHM': { type: 'string' },
	'AUTH_*_SP_ENC_PRIVATE_KEY': { type: 'string' },
	'AUTH_*_SP_ENC_PRIVATE_KEY_PASS': { type: 'string' },
	'AUTH_*_SP_SIGNING_CERT': { type: 'string' },
	'AUTH_*_SP_ENCRYPT_CERT': { type: 'string' },
	'AUTH_*_SP_RELAY_STATE': { type: 'string' },
	'AUTH_*_SP_AUTHN_REQUESTS_SIGNED': { type: 'boolean' },
	'AUTH_*_SP_WANT_ASSERTIONS_SIGNED': { type: 'boolean' },
	'AUTH_*_SP_WANT_MESSAGE_SIGNED': { type: 'boolean' },
	'AUTH_*_SP_WANT_LOGOUT_RESPONSE_SIGNED': { type: 'boolean' },
	'AUTH_*_SP_WANT_LOGOUT_REQUEST_SIGNED': { type: 'boolean' },
	'AUTH_*_SP_IS_ASSERTION_ENCRYPTED': { type: 'boolean' },
	'AUTH_*_SP_ALLOW_CREATE': { type: 'boolean' },
	'AUTH_*_SP_TRANSFORMATION_ALGORITHMS': { type: 'string[]' },
	'AUTH_*_IDP*': {},
	'AUTH_*_SP*': {},
	'AUTH_*_REDIRECT_ALLOW_LIST': { type: 'string[]' },

	// A named connection takes every DB_ option under its own prefix.
	'DB_CONNECTION_*_CLIENT': { type: 'string' },
	'DB_CONNECTION_*_VERSION': { type: 'string' },
	'DB_CONNECTION_*_HOST': { type: 'string' },
	'DB_CONNECTION_*_FILENAME': { type: 'string' },
	'DB_CONNECTION_*_CONNECTION_STRING': { type: 'string' },
	'DB_CONNECTION_*_SEARCH_PATH': { type: 'string[]' },
	'DB_CONNECTION_*_APPLICATION_NAME': { type: 'string' },
	'DB_CONNECTION_*_HEALTHCHECK_THRESHOLD': { type: 'number' },
	'DB_CONNECTION_*_KEEP_ALIVE': { type: 'boolean' },
	'DB_CONNECTION_*_KEEP_ALIVE_INITIAL_DELAY_MILLIS': { type: 'number' },
	'DB_CONNECTION_*_CONNECTION_TIMEOUT_MILLIS': { type: 'number' },
	// Ahead of the _OPTIONS glob, which its name also matches.
	'DB_CONNECTION_*_SSL__SECURE_OPTIONS': { type: 'number' },
	'DB_CONNECTION_*_OPTIONS': { type: 'string' },
	'DB_CONNECTION_*_CHARSET': { type: 'string' },
	'DB_CONNECTION_*_TIMEZONE': { type: 'string' },
	'DB_CONNECTION_*_CONNECT_TIMEOUT': { type: 'number' },
	'DB_CONNECTION_*_SOCKET_PATH': { type: 'string' },
	'DB_CONNECTION_*_SUPPORT_BIG_NUMBERS': { type: 'boolean' },
	'DB_CONNECTION_*_BIG_NUMBER_STRINGS': { type: 'boolean' },
	'DB_CONNECTION_*_DATE_STRINGS': { type: 'boolean' },
	'DB_CONNECTION_*_DECIMAL_NUMBERS': { type: 'boolean' },
	'DB_CONNECTION_*_POOL__PROPAGATE_CREATE_ERROR': { type: 'boolean' },
	// TODO(#610): mysql2 also takes an ssl profile name here.
	'DB_CONNECTION_*_SSL': { type: 'boolean' },
	// Open option sets a reader forwards whole: the tls options knex hands to
	// the driver, and the CSP directives helmet takes by any name.
	// The keys of node's tls ConnectionOptions knex types ssl with; a socket,
	// a Buffer or a function is left to the glob after them.
	'DB_SSL__HOST': { type: 'string' },
	'DB_SSL__PATH': { type: 'string' },
	'DB_SSL__SERVERNAME': { type: 'string' },
	'DB_SSL__SIGALGS': { type: 'string' },
	'DB_SSL__CIPHERS': { type: 'string' },
	'DB_SSL__CLIENT_CERT_ENGINE': { type: 'string' },
	'DB_SSL__ECDH_CURVE': { type: 'string' },
	'DB_SSL__PRIVATE_KEY_ENGINE': { type: 'string' },
	'DB_SSL__PRIVATE_KEY_IDENTIFIER': { type: 'string' },
	'DB_SSL__MAX_VERSION': { type: 'string' },
	'DB_SSL__MIN_VERSION': { type: 'string' },
	'DB_SSL__PASSPHRASE': { type: 'string' },
	'DB_SSL__SECURE_PROTOCOL': { type: 'string' },
	'DB_SSL__SESSION_ID_CONTEXT': { type: 'string' },
	'DB_SSL__CA': { type: 'string' },
	'DB_SSL__CERT': { type: 'string' },
	'DB_SSL__CRL': { type: 'string' },
	'DB_SSL__DHPARAM': { type: 'string' },
	'DB_SSL__KEY': { type: 'string' },
	'DB_SSL__PFX': { type: 'string' },
	'DB_SSL__PORT': { type: 'number' },
	'DB_SSL__TIMEOUT': { type: 'number' },
	'DB_SSL__SECURE_OPTIONS': { type: 'number' },
	'DB_SSL__SESSION_TIMEOUT': { type: 'number' },
	'DB_SSL__ENABLE_TRACE': { type: 'boolean' },
	'DB_SSL__REQUEST_CERT': { type: 'boolean' },
	'DB_SSL__REJECT_UNAUTHORIZED': { type: 'boolean' },
	'DB_SSL__ALLOW_PARTIAL_TRUST_CHAIN': { type: 'boolean' },
	'DB_SSL__HONOR_CIPHER_ORDER': { type: 'boolean' },
	'DB_CONNECTION_*_SSL__HOST': { type: 'string' },
	'DB_CONNECTION_*_SSL__PATH': { type: 'string' },
	'DB_CONNECTION_*_SSL__SERVERNAME': { type: 'string' },
	'DB_CONNECTION_*_SSL__SIGALGS': { type: 'string' },
	'DB_CONNECTION_*_SSL__CIPHERS': { type: 'string' },
	'DB_CONNECTION_*_SSL__CLIENT_CERT_ENGINE': { type: 'string' },
	'DB_CONNECTION_*_SSL__ECDH_CURVE': { type: 'string' },
	'DB_CONNECTION_*_SSL__PRIVATE_KEY_ENGINE': { type: 'string' },
	'DB_CONNECTION_*_SSL__PRIVATE_KEY_IDENTIFIER': { type: 'string' },
	'DB_CONNECTION_*_SSL__MAX_VERSION': { type: 'string' },
	'DB_CONNECTION_*_SSL__MIN_VERSION': { type: 'string' },
	'DB_CONNECTION_*_SSL__PASSPHRASE': { type: 'string' },
	'DB_CONNECTION_*_SSL__SECURE_PROTOCOL': { type: 'string' },
	'DB_CONNECTION_*_SSL__SESSION_ID_CONTEXT': { type: 'string' },
	'DB_CONNECTION_*_SSL__CA': { type: 'string' },
	'DB_CONNECTION_*_SSL__CERT': { type: 'string' },
	'DB_CONNECTION_*_SSL__CRL': { type: 'string' },
	'DB_CONNECTION_*_SSL__DHPARAM': { type: 'string' },
	'DB_CONNECTION_*_SSL__KEY': { type: 'string' },
	'DB_CONNECTION_*_SSL__PFX': { type: 'string' },
	'DB_CONNECTION_*_SSL__PORT': { type: 'number' },
	'DB_CONNECTION_*_SSL__TIMEOUT': { type: 'number' },
	'DB_CONNECTION_*_SSL__SESSION_TIMEOUT': { type: 'number' },
	'DB_CONNECTION_*_SSL__ENABLE_TRACE': { type: 'boolean' },
	'DB_CONNECTION_*_SSL__REQUEST_CERT': { type: 'boolean' },
	'DB_CONNECTION_*_SSL__REJECT_UNAUTHORIZED': { type: 'boolean' },
	'DB_CONNECTION_*_SSL__ALLOW_PARTIAL_TRUST_CHAIN': { type: 'boolean' },
	'DB_CONNECTION_*_SSL__HONOR_CIPHER_ORDER': { type: 'boolean' },
	'DB_SSL__*': {},
	'DB_CONNECTION_*_SSL__*': {},
	// helmet drops a directive set to null.
	'CONTENT_SECURITY_POLICY_DIRECTIVES__*': { type: 'null | string[]' },
	'ASSETS_CONTENT_SECURITY_POLICY_DIRECTIVES__*': {
		type: 'null | string[]',
	},
} as const satisfies Record<string, CoreEnvVarDeclaration>;
