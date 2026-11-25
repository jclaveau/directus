import { DEFAULT_CHUNK_SIZE } from '@directus/constants';
import type { EnvDeclaration } from '../types/env-declaration.js';

/**
 * Every variable core reads with a known type: its type, its default when it
 * has one, and the values it may take when only some are meant. The defaults
 * and the types the loader casts by are read off this one table, and so is the
 * type of `useEnv()`.
 */
export const ENV_DECLARATIONS = {
	HOST: { type: 'string', default: '0.0.0.0' },
	PORT: { type: 'string', default: 8055 },

	DB_NAME: { type: 'string' },
	DB_USER: { type: 'string' },
	DB_PASSWORD: { type: 'string' },
	DB_DATABASE: { type: 'string' },
	DB_PORT: { type: 'number' },

	DB_EXCLUDE_TABLES: { type: 'string[]', default: 'spatial_ref_sys,sysdiagrams' },
	DB_BATCH_INSERT_CHUNK_SIZE: { type: 'number' },
	DB_MSSQL_TRUST_BATCH_RETURNING: { type: 'boolean', default: false },

	DB_CONNECTIONS: { type: 'string[]' },
	DB_BASE_CONNECTION_NAME: { type: 'string' },
	DB_BASE_CONNECTION_PRIORITY: { type: 'number' },
	DB_PUBLIC_SHARE_CONNECTION_NAME: { type: 'string' },

	CACHE_ENABLED: { type: 'boolean', default: false },
	CACHE_RESPONSE: { type: 'boolean' },
	CACHE_COMPRESSION_ENABLED: { type: 'boolean', default: true },
	CACHE_KEY_HASH_ENABLED: { type: 'boolean', default: true },
	CACHE_TTL: { type: 'string', default: '5m' },
	CACHE_CONTROL_S_MAXAGE: { type: 'number', default: '0' },
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
	CACHE_AUDIT_IGNORE_PATHS: { type: 'string[]', default: '' },
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
		default: 'directus_activity,directus_presets',
	},
	// Default on for the formats a cached endpoint might content-negotiate. Safe
	// because browsers/SDKs collapse to json (only an explicit text/csv etc. gets
	// its own bucket). Deliberately NOT xml/html: browsers send them high-q in
	// Accept, so req.accepts would route ALL browser traffic to that bucket and
	// split it from api-client json — fragmenting every install, even non-xml ones.
	CACHE_VARY_CONTENT_TYPES: { type: 'string[]', default: 'json,csv,yaml' },
	CACHE_VARY_REQUEST_HEADERS: { type: 'string[]', default: '' },
	// Extra request headers a glob must never fold, on top of the built-in
	// proxy/CDN/tracing denylist (x-forwarded-*, cf-*, x-envoy-*, …). Add
	// platform-specific per-request headers here; globs allowed.
	CACHE_VARY_REQUEST_HEADERS_EXCLUDED: { type: 'string[]', default: '' },
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
		default: 'ifd0.Make,ifd0.Model,exif.FNumber,exif.ExposureTime,'
			+ 'exif.FocalLength,exif.ISOSpeedRatings',
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
	METRICS_SERVICES: { type: 'string[]', default: 'database,cache,redis,storage' },
	METRICS_ENABLED: { type: 'boolean', default: false },

	SYSTEM_MCP_ENABLED: { type: 'boolean', default: false },
	SYSTEM_MCP_TOOLS: { type: 'string[]', default: 'processes,cache' },
	SYSTEM_MCP_ALLOWED_ORIGINS: { type: 'string[]', default: '' },

	PROCESSES_REPORT_ENABLED: { type: 'boolean', default: true },
	PROCESSES_REPORT_DETAILS: { type: 'string[]', default: 'stats,env' },
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
	PGBOUNCER_CONNECTIONS: { type: 'string[]', default: '' },
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

	STORAGE_LOCATIONS: { type: 'string[]', default: 'local' },
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
	CORS_METHODS: { type: 'string[]', default: 'GET,POST,PATCH,DELETE' },
	CORS_ALLOWED_HEADERS: { type: 'string[]', default: 'Content-Type,Authorization' },
	CORS_EXPOSED_HEADERS: { type: 'string[]', default: 'Content-Range' },
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
	TUS_CHUNK_SIZE: { type: 'string', default: DEFAULT_CHUNK_SIZE }, // 8mb
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

	FILES_MIME_TYPE_ALLOW_LIST: { type: 'string[]', default: '*/*' },

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
} as const satisfies Record<string, EnvDeclaration>;

/**
 * The variables of a named connection, location or provider, whose names hold
 * a part the deployment chooses: keyed by the pattern of the name.
 */
export const ENV_PATTERN_DECLARATIONS = {
	'DB_CONNECTION_.+_PRIORITY': { type: 'number' },
	'DB_CONNECTION_.+_PORT': { type: 'number' },
	'DB_CONNECTION_.+_DATABASE': { type: 'string' },
	'DB_CONNECTION_.+_USER': { type: 'string' },
	'DB_CONNECTION_.+_PASSWORD': { type: 'string' },
	'DB_(CONNECTION_.+_)?POOL__(MIN|MAX)': { type: 'number' },
	'DB_(CONNECTION_.+_)?POOL__.+_MILLIS': { type: 'number' },
	'PGBOUNCER_.+_ADMIN_HOSTS': { type: 'string[]' },
	'PGBOUNCER_.+_ADMIN_DATABASE': { type: 'string' },
	'PGBOUNCER_.+_ADMIN_USER': { type: 'string' },
	'PGBOUNCER_.+_ADMIN_PASSWORD': { type: 'string' },
	'AUTH_.+_BIND_PASSWORD': { type: 'string' },
	'STORAGE_.+_SECRET': { type: 'string' },
} as const satisfies Record<string, EnvDeclaration>;
