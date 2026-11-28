//#region src/constants/env-var-declarations.d.ts
/**
 * Every variable core reads: its type, its default when it has one, and the
 * values it may take when only some are meant; one without a type has its value
 * guessed. The defaults, the types the loader casts by, the names an extension
 * may not declare and the names read off a `_FILE` are read off this one table
 * and {@link ENV_VAR_PATTERN_DECLARATIONS}, and so is the type of `useEnv()`.
 */
declare const ENV_VAR_DECLARATIONS: {
  readonly HOST: {
    readonly type: "string";
    readonly default: "0.0.0.0";
  };
  readonly PORT: {
    readonly type: "string";
    readonly default: "8055";
  };
  readonly DB_NAME: {
    readonly type: "string";
  };
  readonly DB_USER: {
    readonly type: "string";
  };
  readonly DB_PASSWORD: {
    readonly type: "string";
  };
  readonly DB_DATABASE: {
    readonly type: "string";
  };
  readonly DB_PORT: {
    readonly type: "number";
  };
  readonly DB_EXCLUDE_TABLES: {
    readonly type: "string[]";
    readonly default: readonly ["spatial_ref_sys", "sysdiagrams"];
  };
  readonly DB_BATCH_INSERT_CHUNK_SIZE: {
    readonly type: "number";
  };
  readonly DB_CONNECTIONS: {
    readonly type: "string[]";
  };
  readonly DB_BASE_CONNECTION_NAME: {
    readonly type: "string";
  };
  readonly DB_BASE_CONNECTION_PRIORITY: {
    readonly type: "number";
  };
  readonly DB_PUBLIC_SHARE_CONNECTION_NAME: {
    readonly type: "string";
  };
  readonly CACHE_ENABLED: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly CACHE_RESPONSE: {
    readonly type: "boolean";
  };
  readonly CACHE_COMPRESSION_ENABLED: {
    readonly type: "boolean";
    readonly default: true;
  };
  readonly CACHE_KEY_HASH_ENABLED: {
    readonly type: "boolean";
    readonly default: true;
  };
  readonly CACHE_TTL: {
    readonly type: "string";
    readonly default: "5m";
  };
  readonly CACHE_CONTROL_S_MAXAGE: {
    readonly type: "number";
    readonly default: 0;
  };
  readonly CACHE_NAMESPACE: {
    readonly type: "string";
    readonly default: "scalabus";
  };
  readonly CACHE_AUTO_PURGE: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly CACHE_AUTO_PURGE_MODE: {
    readonly type: "string";
    readonly default: "scoped";
    readonly values: readonly ["scoped", "full"];
  };
  readonly CACHE_SCOPED_MAX_PINS_PER_COLLECTION: {
    readonly type: "number";
    readonly default: 250;
  };
  readonly CACHE_SCOPED_MAX_QUERY_CASES: {
    readonly type: "number";
    readonly default: 16;
  };
  readonly CACHE_SCOPED_MAX_ON_DELETE_ROWS: {
    readonly type: "number";
    readonly default: 1000;
  };
  readonly CACHE_SCOPED_INDEX_SCAN_COUNT: {
    readonly type: "number";
    readonly default: 1000;
  };
  readonly CACHE_SCOPED_INDEX_TTL_FACTOR: {
    readonly type: "number";
    readonly default: 2;
  };
  readonly CACHE_SCOPED_PURGE_RETRY_INTERVAL: {
    readonly type: "string";
    readonly default: "1m";
  };
  readonly CACHE_SCOPED_PURGE_RETRY_MAX_FINGERPRINTS: {
    readonly type: "number";
    readonly default: 100;
  };
  readonly CACHE_SCOPED_EPOCH_TTL: {
    readonly type: "string";
    readonly default: "24h";
  };
  readonly CACHE_SCOPED_INDEX_REAP_SCHEDULE: {
    readonly type: "string";
    readonly default: "0 * * * *";
  };
  readonly CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX: {
    readonly type: "string";
    readonly default: "5m";
  };
  readonly CACHE_SCHEMA: {
    readonly type: "boolean";
    readonly default: true;
  };
  readonly CACHE_STORE: {
    readonly type: "string";
    readonly default: "memory";
    readonly values: readonly ["memory", "redis"];
  };
  readonly CACHE_REDIS_DB: {
    readonly type: "number";
  };
  readonly CACHE_SKIP_ALLOWED: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly CACHE_AUTO_FLUSH_ON_DEPLOY: {
    readonly type: "boolean";
    readonly default: true;
  };
  readonly CACHE_AUTO_FLUSH_ON_DEPLOY_TIMEOUT: {
    readonly type: "string";
    readonly default: "30s";
  };
  readonly CACHE_FLUSH_TIMEOUT: {
    readonly type: "string";
    readonly default: "30s";
  };
  readonly CACHE_BUILD_ID: {
    readonly type: "string";
  };
  readonly CACHE_STATS_ENABLED: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly CACHE_STATS_RETENTION: {
    readonly type: "string";
    readonly default: "30d";
  };
  readonly CACHE_STATS_DRAIN_SCHEDULE: {
    readonly type: "string";
    readonly default: "*/10 * * * * *";
  };
  readonly CACHE_STATS_RETENTION_SCHEDULE: {
    readonly type: "string";
    readonly default: "*/10 * * * *";
  };
  readonly CACHE_STATS_MAX_BYTES: {
    readonly type: "string";
    readonly default: "2gb";
  };
  readonly CACHE_STATS_MAX_BUFFER: {
    readonly type: "number";
    readonly default: 1000000;
  };
  readonly CACHE_STATS_GAP_LOOKBACK: {
    readonly type: "string";
    readonly default: "1h";
  };
  readonly CACHE_AUDIT_ENABLED: {
    readonly type: "boolean";
    readonly default: true;
  };
  readonly CACHE_AUDIT_SCHEDULE: {
    readonly type: "string";
    readonly default: "";
  };
  readonly CACHE_AUDIT_LIMIT: {
    readonly type: "number";
    readonly default: 0;
  };
  readonly CACHE_AUDIT_MAX_DURATION: {
    readonly type: "string";
    readonly default: "10m";
  };
  readonly CACHE_AUDIT_IGNORE_PATHS: {
    readonly type: "string[]";
    readonly default: readonly [];
  };
  readonly CACHE_AUDIT_RETENTION: {
    readonly type: "string";
    readonly default: "30d";
  };
  readonly CACHE_STATUS_HEADER: {
    readonly type: "string";
  };
  readonly CACHE_TAGS_HEADER: {
    readonly type: "string";
  };
  readonly CACHE_TAGS_HEADER_MAX_SIZE: {
    readonly type: "string";
    readonly default: "4kb";
  };
  readonly CACHE_PURGED_TAGS_HEADER: {
    readonly type: "string";
  };
  readonly QUERY_AUDIT_HEADER: {
    readonly type: "string";
  };
  readonly QUERY_AUDIT_LEVEL: {
    readonly type: "string";
    readonly default: "counts";
  };
  readonly QUERY_AUDIT_HEADER_MAX_SIZE: {
    readonly type: "string";
    readonly default: "8kb";
  };
  readonly CACHE_AUTO_PURGE_IGNORE_LIST: {
    readonly type: "string[]";
    readonly default: readonly ["directus_activity", "directus_presets"];
  };
  readonly CACHE_VARY_CONTENT_TYPES: {
    readonly type: "string[]";
    readonly default: readonly ["json", "csv", "yaml"];
  };
  readonly CACHE_VARY_REQUEST_HEADERS: {
    readonly type: "string[]";
    readonly default: readonly [];
  };
  readonly CACHE_VARY_REQUEST_HEADERS_EXCLUDED: {
    readonly type: "string[]";
    readonly default: readonly [];
  };
  readonly CACHE_SCHEMA_MAX_ITERATIONS: {
    readonly type: "number";
    readonly default: 100;
  };
  readonly CACHE_SCHEMA_SYNC_TIMEOUT: {
    readonly type: "number";
    readonly default: 10000;
  };
  readonly CACHE_SCHEMA_FREEZE_ENABLED: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly RATE_LIMITER_CHARGE: {
    readonly type: "string";
    readonly default: "cache-misses";
  };
  readonly RATE_LIMITER_ENABLED: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly RATE_LIMITER_POINTS: {
    readonly type: "number";
    readonly default: 50;
  };
  readonly RATE_LIMITER_DURATION: {
    readonly type: "number";
    readonly default: 1;
  };
  readonly RATE_LIMITER_STORE: {
    readonly type: "string";
    readonly default: "memory";
    readonly values: readonly ["memory", "redis"];
  };
  readonly RATE_LIMITER_GLOBAL_ENABLED: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly RATE_LIMITER_GLOBAL_POINTS: {
    readonly type: "number";
    readonly default: 1000;
  };
  readonly RATE_LIMITER_GLOBAL_DURATION: {
    readonly type: "number";
    readonly default: 1;
  };
  readonly RATE_LIMITER_REGISTRATION_ENABLED: {
    readonly type: "boolean";
    readonly default: true;
  };
  readonly RATE_LIMITER_REGISTRATION_POINTS: {
    readonly type: "number";
    readonly default: 5;
  };
  readonly RATE_LIMITER_REGISTRATION_DURATION: {
    readonly type: "number";
    readonly default: 60;
  };
  readonly IMPORT_IP_DENY_LIST: {
    readonly type: "string[]";
    readonly default: readonly ["0.0.0.0", "169.254.169.254"];
  };
  readonly FILE_METADATA_ALLOW_LIST: {
    readonly type: "string[]";
    readonly default: readonly ["ifd0.Make", "ifd0.Model", "exif.FNumber", "exif.ExposureTime", "exif.FocalLength", "exif.ISOSpeedRatings"];
  };
  readonly GRAPHQL_INTROSPECTION: {
    readonly type: "boolean";
    readonly default: true;
  };
  readonly GRAPHQL_SCHEMA_GENERATION_MAX_CONCURRENT: {
    readonly type: "number";
    readonly default: 5;
  };
  readonly GRAPHQL_QUERY_TOKEN_LIMIT: {
    readonly type: "number";
    readonly default: 5000;
  };
  readonly MAX_BATCH_MUTATION: {
    readonly type: "number";
    readonly default: number;
  };
  readonly DEFAULT_MUTATION_BATCHING: {
    readonly type: "string";
    readonly default: "preserveMutationOrder";
  };
  readonly SERVER_SHUTDOWN_TIMEOUT: {
    readonly type: "number";
    readonly default: 1000;
  };
  readonly LOG_HTTP_IGNORE_PATHS: {
    readonly type: "string[]";
  };
  readonly REDIS_ENABLED: {
    readonly type: "boolean";
  };
  readonly REDIS_MAX_RETRIES_PER_REQUEST: {
    readonly type: "number";
  };
  readonly REDIS_RETRY_BASE_DELAY: {
    readonly type: "number";
  };
  readonly REDIS_RETRY_MAX_DELAY: {
    readonly type: "number";
  };
  readonly REDIS_RETRY_MAX_ATTEMPTS: {
    readonly type: "number";
  };
  readonly BUS_NAMESPACE: {
    readonly type: "string";
  };
  readonly METRICS_TOKENS: {
    readonly type: "string[]";
  };
  readonly METRICS_SERVICES: {
    readonly type: "string[]";
    readonly default: readonly ["database", "cache", "redis", "storage"];
  };
  readonly METRICS_ENABLED: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly SYSTEM_MCP_ENABLED: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly SYSTEM_MCP_TOOLS: {
    readonly type: "string[]";
    readonly default: readonly ["processes", "cache"];
  };
  readonly SYSTEM_MCP_ALLOWED_ORIGINS: {
    readonly type: "string[]";
    readonly default: readonly [];
  };
  readonly PROCESSES_REPORT_ENABLED: {
    readonly type: "boolean";
    readonly default: true;
  };
  readonly PROCESSES_REPORT_DETAILS: {
    readonly type: "string[]";
    readonly default: readonly ["stats", "env"];
  };
  readonly PROCESSES_SERVICE_NAME: {
    readonly type: "string";
  };
  readonly PROCESSES_COLLECT_TIMEOUT: {
    readonly type: "string";
    readonly default: "750ms";
  };
  readonly PM2_HOME: {
    readonly type: "string";
  };
  readonly PM2_INSTANCES: {
    readonly type: "number";
  };
  readonly PM2_EXEC_MODE: {
    readonly type: "string";
  };
  readonly PM2_MAX_MEMORY_RESTART: {
    readonly type: "string";
  };
  readonly PM2_MIN_UPTIME: {
    readonly type: "number";
  };
  readonly PM2_LISTEN_TIMEOUT: {
    readonly type: "number";
  };
  readonly PM2_KILL_TIMEOUT: {
    readonly type: "number";
  };
  readonly PM2_MAX_RESTARTS: {
    readonly type: "number";
  };
  readonly PM2_RESTART_DELAY: {
    readonly type: "number";
  };
  readonly PM2_AUTO_RESTART: {
    readonly type: "string";
  };
  readonly PM2_LOG_ERROR_FILE: {
    readonly type: "string";
  };
  readonly PM2_LOG_OUT_FILE: {
    readonly type: "string";
  };
  readonly PM2_AUTOSCALE_ENABLED: {
    readonly type: "boolean";
  };
  readonly PM2_AUTOSCALE_APP_NAME: {
    readonly type: "string";
  };
  readonly PM2_AUTOSCALE_SIGNAL: {
    readonly type: "string";
  };
  readonly PM2_AUTOSCALE_STRATEGY: {
    readonly type: "string";
  };
  readonly PM2_AUTOSCALE_SAMPLE_WINDOW: {
    readonly type: "number";
  };
  readonly PM2_AUTOSCALE_SCALE_CPU_THRESHOLD: {
    readonly type: "number";
  };
  readonly PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD: {
    readonly type: "number";
  };
  readonly PM2_AUTOSCALE_MIN_WORKERS: {
    readonly type: "number";
  };
  readonly PM2_AUTOSCALE_MAX_WORKERS: {
    readonly type: "number";
  };
  readonly PM2_AUTOSCALE_PREWARM: {
    readonly type: "number";
  };
  readonly PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER: {
    readonly type: "number";
  };
  readonly PM2_AUTOSCALE_MIN_SECONDS_TO_RELEASE_WORKER: {
    readonly type: "number";
  };
  readonly PM2_AUTOSCALE_WARMUP_SECONDS: {
    readonly type: "number";
  };
  readonly PM2_AUTOSCALE_DRILL_ENABLED: {
    readonly type: "boolean";
  };
  readonly PM2_POOL_HEALTH_REFRESH: {
    readonly type: "string";
  };
  readonly SHARED_SETTINGS_POLL_SECONDS: {
    readonly type: "number";
  };
  readonly PGBOUNCER_REPORT_ENABLED: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly PGBOUNCER_CONNECTIONS: {
    readonly type: "string[]";
    readonly default: readonly [];
  };
  readonly PGBOUNCER_QUERY_TIMEOUT: {
    readonly type: "string";
    readonly default: "2s";
  };
  readonly MIGRATIONS_WAIT_TIMEOUT: {
    readonly type: "string";
    readonly default: "5m";
  };
  readonly MIGRATIONS_WAIT_INTERVAL: {
    readonly type: "string";
    readonly default: "2s";
  };
  readonly PUBLIC_URL: {
    readonly type: "string";
    readonly default: "/";
  };
  readonly MAX_PAYLOAD_SIZE: {
    readonly type: "string";
    readonly default: "1mb";
  };
  readonly MAX_RELATIONAL_DEPTH: {
    readonly type: "number";
    readonly default: 10;
  };
  readonly QUERYSTRING_MAX_PARSE_DEPTH: {
    readonly type: "number";
    readonly default: 10;
  };
  readonly QUERY_LIMIT_DEFAULT: {
    readonly type: "number";
    readonly default: 100;
  };
  readonly ROBOTS_TXT: {
    readonly type: "string";
    readonly default: "User-agent: *\nDisallow: /";
  };
  readonly TEMP_PATH: {
    readonly type: "string";
    readonly default: "./node_modules/.directus";
  };
  readonly STORAGE_LOCATIONS: {
    readonly type: "string[]";
    readonly default: readonly ["local"];
  };
  readonly STORAGE_LOCAL_DRIVER: {
    readonly type: "string";
    readonly default: "local";
  };
  readonly STORAGE_LOCAL_ROOT: {
    readonly type: "string";
    readonly default: "./uploads";
  };
  readonly ACCESS_TOKEN_TTL: {
    readonly type: "string";
    readonly default: "15m";
  };
  readonly EMAIL_VERIFICATION_TOKEN_TTL: {
    readonly type: "string";
    readonly default: "7d";
  };
  readonly EMAIL_FROM: {
    readonly type: "string";
    readonly default: "no-reply@example.com";
  };
  readonly EMAIL_VERIFY_SETUP: {
    readonly type: "boolean";
    readonly default: true;
  };
  readonly EMAIL_TRANSPORT: {
    readonly type: "string";
    readonly default: "sendmail";
  };
  readonly EMAIL_SENDMAIL_NEW_LINE: {
    readonly type: "string";
    readonly default: "unix";
  };
  readonly EMAIL_SENDMAIL_PATH: {
    readonly type: "string";
    readonly default: "/usr/sbin/sendmail";
  };
  readonly EMAIL_TEMPLATES_PATH: {
    readonly type: "string";
    readonly default: "./templates";
  };
  readonly REFRESH_TOKEN_TTL: {
    readonly type: "string";
    readonly default: "7d";
  };
  readonly REFRESH_TOKEN_COOKIE_NAME: {
    readonly type: "string";
    readonly default: "directus_refresh_token";
  };
  readonly REFRESH_TOKEN_COOKIE_SECURE: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly REFRESH_TOKEN_COOKIE_SAME_SITE: {
    readonly type: "string";
    readonly default: "lax";
  };
  readonly SESSION_COOKIE_TTL: {
    readonly type: "string";
    readonly default: "1d";
  };
  readonly SESSION_COOKIE_NAME: {
    readonly type: "string";
    readonly default: "directus_session_token";
  };
  readonly SESSION_COOKIE_SECURE: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly SESSION_COOKIE_SAME_SITE: {
    readonly type: "string";
    readonly default: "lax";
  };
  readonly SESSION_REFRESH_GRACE_PERIOD: {
    readonly type: "string";
    readonly default: "10s";
  };
  readonly USER_INVITE_TOKEN_TTL: {
    readonly type: "string";
    readonly default: "7d";
  };
  readonly LOGIN_STALL_TIME: {
    readonly type: "number";
    readonly default: 500;
  };
  readonly REGISTER_STALL_TIME: {
    readonly type: "number";
    readonly default: 750;
  };
  readonly CORS_ENABLED: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly CORS_METHODS: {
    readonly type: "string[]";
    readonly default: readonly ["GET", "POST", "PATCH", "DELETE"];
  };
  readonly CORS_ALLOWED_HEADERS: {
    readonly type: "string[]";
    readonly default: readonly ["Content-Type", "Authorization"];
  };
  readonly CORS_EXPOSED_HEADERS: {
    readonly type: "string[]";
    readonly default: readonly ["Content-Range"];
  };
  readonly CORS_CREDENTIALS: {
    readonly type: "boolean";
    readonly default: true;
  };
  readonly CORS_MAX_AGE: {
    readonly type: "number";
    readonly default: 18000;
  };
  readonly AUTH_DISABLE_DEFAULT: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly PACKAGE_FILE_LOCATION: {
    readonly type: "string";
    readonly default: ".";
  };
  readonly EXTENSIONS_MUST_LOAD: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly EXTENSIONS_AUTO_RELOAD: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly EXTENSIONS_AUTO_MIGRATE: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly EXTENSIONS_SANDBOX_MEMORY: {
    readonly type: "number";
    readonly default: 100;
  };
  readonly EXTENSIONS_SANDBOX_TIMEOUT: {
    readonly type: "number";
    readonly default: 1000;
  };
  readonly MIGRATIONS_PATH: {
    readonly type: "string";
    readonly default: "./migrations";
  };
  readonly MIGRATIONS_STATEMENT_TIMEOUT: {
    readonly type: "string";
    readonly default: "0";
  };
  readonly MIGRATIONS_LOCK_TIMEOUT: {
    readonly type: "string";
    readonly default: "10s";
  };
  readonly MIGRATIONS_IDLE_IN_TRANSACTION_SESSION_TIMEOUT: {
    readonly type: "string";
    readonly default: "0";
  };
  readonly MARKETPLACE_ENABLED: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly MARKETPLACE_TRUST: {
    readonly type: "string";
    readonly default: "sandbox";
  };
  readonly OUT_OF_SCOPE_FEATURES_ALLOWED: {
    readonly type: "string[]";
    readonly default: readonly [];
  };
  readonly TELEMETRY: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly TELEMETRY_URL: {
    readonly type: "string";
    readonly default: "https://telemetry.directus.io";
  };
  readonly ASSETS_CACHE_TTL: {
    readonly type: "string";
    readonly default: "30d";
  };
  readonly ASSETS_TRANSFORM_MAX_CONCURRENT: {
    readonly type: "number";
    readonly default: 25;
  };
  readonly ASSETS_TRANSFORM_IMAGE_MAX_DIMENSION: {
    readonly type: "number";
    readonly default: 6000;
  };
  readonly ASSETS_TRANSFORM_MAX_OPERATIONS: {
    readonly type: "number";
    readonly default: 5;
  };
  readonly ASSETS_TRANSFORM_TIMEOUT: {
    readonly type: "string";
    readonly default: "7500ms";
  };
  readonly ASSETS_INVALID_IMAGE_SENSITIVITY_LEVEL: {
    readonly type: "string";
    readonly default: "warning";
  };
  readonly SERVE_APP: {
    readonly type: "boolean";
    readonly default: true;
  };
  readonly RELATIONAL_BATCH_SIZE: {
    readonly type: "number";
    readonly default: 25000;
  };
  readonly EXPORT_BATCH_SIZE: {
    readonly type: "number";
    readonly default: 5000;
  };
  readonly USERS_ADMIN_ACCESS_LIMIT: {
    readonly type: "number";
    readonly default: number;
  };
  readonly USERS_APP_ACCESS_LIMIT: {
    readonly type: "number";
    readonly default: number;
  };
  readonly USERS_API_ACCESS_LIMIT: {
    readonly type: "number";
    readonly default: number;
  };
  readonly TUS_ENABLED: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly TUS_CHUNK_SIZE: {
    readonly type: "string";
    readonly default: string;
  };
  readonly TUS_UPLOAD_EXPIRATION: {
    readonly type: "string";
    readonly default: "10m";
  };
  readonly RETENTION_ENABLED: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly RETENTION_BATCH: {
    readonly type: "number";
    readonly default: 500;
  };
  readonly ACTIVITY_RETENTION: {
    readonly type: "string";
    readonly default: "90d";
  };
  readonly REVISIONS_RETENTION: {
    readonly type: "string";
    readonly default: "90d";
  };
  readonly FLOW_LOGS_RETENTION: {
    readonly type: "string";
    readonly default: "90d";
  };
  readonly WEBSOCKETS_ENABLED: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly WEBSOCKETS_REST_ENABLED: {
    readonly type: "boolean";
    readonly default: true;
  };
  readonly WEBSOCKETS_REST_AUTH: {
    readonly type: "string";
    readonly default: "handshake";
  };
  readonly WEBSOCKETS_REST_AUTH_TIMEOUT: {
    readonly type: "number";
    readonly default: 10;
  };
  readonly WEBSOCKETS_REST_PATH: {
    readonly type: "string";
    readonly default: "/websocket";
  };
  readonly WEBSOCKETS_GRAPHQL_ENABLED: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly WEBSOCKETS_GRAPHQL_AUTH: {
    readonly type: "string";
    readonly default: "handshake";
  };
  readonly WEBSOCKETS_GRAPHQL_AUTH_TIMEOUT: {
    readonly type: "number";
    readonly default: 10;
  };
  readonly WEBSOCKETS_GRAPHQL_PATH: {
    readonly type: "string";
    readonly default: "/graphql";
  };
  readonly WEBSOCKETS_HEARTBEAT_ENABLED: {
    readonly type: "boolean";
    readonly default: true;
  };
  readonly WEBSOCKETS_HEARTBEAT_PERIOD: {
    readonly type: "number";
    readonly default: 30;
  };
  readonly WEBSOCKETS_LOGS_ENABLED: {
    readonly type: "boolean";
    readonly default: true;
  };
  readonly WEBSOCKETS_LOGS_PATH: {
    readonly type: "string";
    readonly default: "/websocket/logs";
  };
  readonly FLOWS_RUN_SCRIPT_MAX_MEMORY: {
    readonly type: "number";
    readonly default: 32;
  };
  readonly FLOWS_RUN_SCRIPT_TIMEOUT: {
    readonly type: "number";
    readonly default: 10000;
  };
  readonly PRESSURE_LIMITER_ENABLED: {
    readonly type: "boolean";
    readonly default: true;
  };
  readonly PRESSURE_LIMITER_SAMPLE_INTERVAL: {
    readonly type: "number";
    readonly default: 250;
  };
  readonly PRESSURE_LIMITER_MAX_EVENT_LOOP_UTILIZATION: {
    readonly type: "number";
    readonly default: 0.99;
  };
  readonly PRESSURE_LIMITER_MAX_EVENT_LOOP_DELAY: {
    readonly type: "number";
    readonly default: 500;
  };
  readonly FILES_MIME_TYPE_ALLOW_LIST: {
    readonly type: "string[]";
    readonly default: readonly ["*/*"];
  };
  readonly ACCEPT_TERMS: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly DB_SSL__CA_FILE: {
    readonly type: "string";
  };
  readonly ADMIN_PASSWORD: {
    readonly type: "string";
  };
  readonly ADMIN_TOKEN: {
    readonly type: "string";
  };
  readonly KEY: {
    readonly type: "string";
  };
  readonly SECRET: {
    readonly type: "string";
  };
  readonly METRICS_SCHEDULE: {
    readonly type: "string";
    readonly default: "*/1 * * * *";
  };
  readonly RETENTION_SCHEDULE: {
    readonly type: "string";
    readonly default: "0 0 * * *";
  };
  readonly TUS_CLEANUP_SCHEDULE: {
    readonly type: "string";
    readonly default: "0 * * * *";
  };
  readonly EXTENSIONS_ROLLDOWN: {
    readonly type: "boolean";
    readonly default: false;
  };
  readonly EMAIL_SMTP_PASSWORD: {
    readonly type: "string";
  };
  readonly REDIS_PASSWORD: {
    readonly type: "string";
  };
  readonly AUTH_PROVIDERS: {
    readonly type: "string[]";
    readonly default: readonly [];
  };
  readonly CONFIG_PATH: {
    readonly type: "string";
    readonly default: string;
  };
  readonly ROOT_REDIRECT: {
    readonly type: "false | string";
    readonly default: "./admin";
  };
  readonly CACHE_VALUE_MAX_SIZE: {
    readonly type: "false | string";
    readonly default: false;
  };
  readonly IP_CUSTOM_HEADER: {
    readonly type: "false | string";
    readonly default: false;
  };
  readonly FLOWS_ENV_ALLOW_LIST: {
    readonly type: "false | string[]";
    readonly default: false;
  };
  readonly PRESSURE_LIMITER_MAX_MEMORY_RSS: {
    readonly type: "false | number";
    readonly default: false;
  };
  readonly PRESSURE_LIMITER_MAX_MEMORY_HEAP_USED: {
    readonly type: "false | number";
    readonly default: false;
  };
  readonly PRESSURE_LIMITER_RETRY_AFTER: {
    readonly type: "false | string";
    readonly default: false;
  };
  readonly REDIS_KEEP_ALIVE: {
    readonly type: "false | number";
  };
  readonly CORS_ORIGIN: {
    readonly type: "boolean | number | string | string[]";
    readonly default: false;
  };
  readonly IP_TRUST_PROXY: {
    readonly type: "boolean | number | string | string[]";
    readonly default: true;
  };
  readonly ADMIN_EMAIL: {
    readonly type: "string";
  };
  readonly CACHE_HEALTHCHECK_THRESHOLD: {
    readonly type: "number";
  };
  readonly CACHE_SYSTEM_TTL: {
    readonly type: "string";
  };
  readonly EMAIL_MAILGUN_API_KEY: {
    readonly type: "string";
  };
  readonly EMAIL_MAILGUN_DOMAIN: {
    readonly type: "string";
  };
  readonly EMAIL_MAILGUN_HOST: {
    readonly type: "string";
  };
  readonly EMAIL_SES_CREDENTIALS__ACCESS_KEY_ID: {
    readonly type: "string";
  };
  readonly EMAIL_SES_CREDENTIALS__SECRET_ACCESS_KEY: {
    readonly type: "string";
  };
  readonly EMAIL_SES_REGION: {
    readonly type: "string";
  };
  readonly EMAIL_SMTP_HOST: {
    readonly type: "string";
  };
  readonly EMAIL_SMTP_IGNORE_TLS: {
    readonly type: "boolean";
  };
  readonly EMAIL_SMTP_NAME: {
    readonly type: "string";
  };
  readonly EMAIL_SMTP_POOL: {
    readonly type: "boolean";
  };
  readonly EMAIL_SMTP_PORT: {
    readonly type: "number";
  };
  readonly EMAIL_SMTP_SECURE: {
    readonly type: "boolean";
  };
  readonly EMAIL_SMTP_USER: {
    readonly type: "string";
  };
  readonly EXTENSIONS_CACHE_TTL: {
    readonly type: "string";
  };
  readonly EXTENSIONS_LIMIT: {
    readonly type: "number";
  };
  readonly EXTENSIONS_LOCATION: {
    readonly type: "string";
  };
  readonly EXTENSIONS_PATH: {
    readonly type: "string";
  };
  readonly FILES_CONTENT_TYPE_ALLOW_LIST: {
    readonly type: "string[]";
  };
  readonly FILES_MAX_UPLOAD_SIZE: {
    readonly type: "string";
  };
  readonly GRAPHQL_SCHEMA_CACHE_CAPACITY: {
    readonly type: "number";
  };
  readonly LOG_LEVEL: {
    readonly type: "string";
  };
  readonly LOG_STYLE: {
    readonly type: "string";
  };
  readonly MARKETPLACE_REGISTRY: {
    readonly type: "string";
  };
  readonly PASSWORD_RESET_URL_ALLOW_LIST: {
    readonly type: "string[]";
  };
  readonly PROJECT_NAME: {
    readonly type: "string";
  };
  readonly QUERY_LIMIT_MAX: {
    readonly type: "number";
  };
  readonly REDIS: {
    readonly type: "string";
  };
  readonly REDIS_DB: {
    readonly type: "number";
  };
  readonly REDIS_HOST: {
    readonly type: "string";
  };
  readonly REDIS_PORT: {
    readonly type: "number";
  };
  readonly REDIS_USERNAME: {
    readonly type: "string";
  };
  readonly REFRESH_TOKEN_COOKIE_DOMAIN: {
    readonly type: "string";
  };
  readonly SESSION_COOKIE_DOMAIN: {
    readonly type: "string";
  };
  readonly SYNCHRONIZATION_NAMESPACE: {
    readonly type: "string";
  };
  readonly SYNCHRONIZATION_STORE: {
    readonly type: "string";
  };
  readonly TELEMETRY_AUTHORIZATION: {
    readonly type: "string";
  };
  readonly UNIX_SOCKET_PATH: {
    readonly type: "string";
  };
  readonly USER_INVITE_URL_ALLOW_LIST: {
    readonly type: "string[]";
  };
  readonly USER_REGISTER_URL_ALLOW_LIST: {
    readonly type: "string[]";
  };
  readonly WEBSOCKETS_LOGS_LEVEL: {
    readonly type: "string";
  };
  readonly WEBSOCKETS_LOGS_STYLE: {
    readonly type: "string";
  };
  readonly NODE_ENV: {
    readonly type: "string";
  };
  readonly RAILWAY_GIT_COMMIT_SHA: {
    readonly type: "string";
  };
  readonly RAILWAY_REPLICA_ID: {
    readonly type: "string";
  };
  readonly RAILWAY_SERVICE_NAME: {
    readonly type: "string";
  };
  readonly name: {
    readonly type: "string";
  };
  readonly DB_CLIENT: {
    readonly type: "string";
  };
  readonly DB_VERSION: {
    readonly type: "string";
  };
  readonly DB_HOST: {
    readonly type: "string";
  };
  readonly DB_FILENAME: {
    readonly type: "string";
  };
  readonly DB_CONNECTION_STRING: {
    readonly type: "string";
  };
  readonly DB_SEARCH_PATH: {
    readonly type: "string[]";
  };
  readonly DB_APPLICATION_NAME: {
    readonly type: "string";
  };
  readonly DB_HEALTHCHECK_THRESHOLD: {
    readonly type: "number";
  };
  readonly DB_KEEP_ALIVE: {
    readonly type: "boolean";
  };
  readonly DB_KEEP_ALIVE_INITIAL_DELAY_MILLIS: {
    readonly type: "number";
  };
  readonly DB_CONNECTION_TIMEOUT_MILLIS: {
    readonly type: "number";
  };
  readonly DB_OPTIONS: {
    readonly type: "string";
  };
  readonly DB_CHARSET: {
    readonly type: "string";
  };
  readonly DB_TIMEZONE: {
    readonly type: "string";
  };
  readonly DB_CONNECT_TIMEOUT: {
    readonly type: "number";
  };
  readonly DB_SOCKET_PATH: {
    readonly type: "string";
  };
  readonly DB_SUPPORT_BIG_NUMBERS: {
    readonly type: "boolean";
  };
  readonly DB_BIG_NUMBER_STRINGS: {
    readonly type: "boolean";
  };
  readonly DB_DATE_STRINGS: {
    readonly type: "boolean";
  };
  readonly DB_DECIMAL_NUMBERS: {
    readonly type: "boolean";
  };
  readonly DB_POOL__PROPAGATE_CREATE_ERROR: {
    readonly type: "boolean";
  };
  readonly DB_SSL: {
    readonly type: "boolean";
  };
  readonly LOGGER_LEVELS: {
    readonly type: "string[]";
  };
  readonly LOGGER_LEVEL: {
    readonly type: "string";
  };
  readonly LOGGER_NAME: {
    readonly type: "string";
  };
  readonly LOGGER_ENABLED: {
    readonly type: "boolean";
  };
  readonly LOGGER_TIMESTAMP: {
    readonly type: "boolean";
  };
  readonly LOGGER_MESSAGE_KEY: {
    readonly type: "string";
  };
  readonly LOGGER_ERROR_KEY: {
    readonly type: "string";
  };
  readonly LOGGER_NESTED_KEY: {
    readonly type: "string";
  };
  readonly LOGGER_MSG_PREFIX: {
    readonly type: "string";
  };
  readonly LOGGER_CRLF: {
    readonly type: "boolean";
  };
  readonly LOGGER_DEPTH_LIMIT: {
    readonly type: "number";
  };
  readonly LOGGER_EDGE_LIMIT: {
    readonly type: "number";
  };
  readonly LOGGER_HTTP_USE_LEVEL: {
    readonly type: "string";
  };
  readonly LOGGER_HTTP_QUIET_REQ_LOGGER: {
    readonly type: "boolean";
  };
  readonly LOGGER_HTTP_QUIET_RES_LOGGER: {
    readonly type: "boolean";
  };
  readonly LOGGER_HTTP_WRAP_SERIALIZERS: {
    readonly type: "boolean";
  };
  readonly SERVER_KEEP_ALIVE_TIMEOUT: {
    readonly type: "number";
  };
  readonly SERVER_HEADERS_TIMEOUT: {
    readonly type: "number";
  };
  readonly SERVER_REQUEST_TIMEOUT: {
    readonly type: "number";
  };
  readonly SERVER_TIMEOUT: {
    readonly type: "number";
  };
  readonly SERVER_MAX_HEADERS_COUNT: {
    readonly type: "number";
  };
  readonly SERVER_MAX_REQUESTS_PER_SOCKET: {
    readonly type: "number";
  };
  readonly HASH_MEMORY_COST: {
    readonly type: "number";
  };
  readonly HASH_TIME_COST: {
    readonly type: "number";
  };
  readonly HASH_PARALLELISM: {
    readonly type: "number";
  };
  readonly HASH_HASH_LENGTH: {
    readonly type: "number";
  };
  readonly HASH_SALT_LENGTH: {
    readonly type: "number";
  };
  readonly HASH_TYPE: {
    readonly type: "number";
  };
  readonly HASH_ASSOCIATED_DATA: {
    readonly type: "string";
  };
  readonly HSTS_ENABLED: {
    readonly type: "boolean";
  };
  readonly HSTS_MAX_AGE: {
    readonly type: "number";
  };
  readonly HSTS_INCLUDE_SUB_DOMAINS: {
    readonly type: "boolean";
  };
  readonly HSTS_PRELOAD: {
    readonly type: "boolean";
  };
  readonly CONTENT_SECURITY_POLICY_USE_DEFAULTS: {
    readonly type: "boolean";
  };
  readonly CONTENT_SECURITY_POLICY_REPORT_ONLY: {
    readonly type: "boolean";
  };
  readonly ASSETS_CONTENT_SECURITY_POLICY_USE_DEFAULTS: {
    readonly type: "boolean";
  };
  readonly ASSETS_CONTENT_SECURITY_POLICY_REPORT_ONLY: {
    readonly type: "boolean";
  };
  readonly RATE_LIMITER_HEALTHCHECK_THRESHOLD: {
    readonly type: "number";
  };
  readonly RATE_LIMITER_GLOBAL_HEALTHCHECK_THRESHOLD: {
    readonly type: "number";
  };
  readonly RATE_LIMITER_KEY_PREFIX: {
    readonly type: "string";
  };
  readonly RATE_LIMITER_BLOCK_DURATION: {
    readonly type: "number";
  };
  readonly RATE_LIMITER_EXEC_EVENLY: {
    readonly type: "boolean";
  };
  readonly RATE_LIMITER_EXEC_EVENLY_MIN_DELAY_MS: {
    readonly type: "number";
  };
  readonly RATE_LIMITER_IN_MEMORY_BLOCK_ON_CONSUMED: {
    readonly type: "number";
  };
  readonly RATE_LIMITER_IN_MEMORY_BLOCK_DURATION: {
    readonly type: "number";
  };
  readonly RATE_LIMITER_GLOBAL_KEY_PREFIX: {
    readonly type: "string";
  };
  readonly RATE_LIMITER_GLOBAL_BLOCK_DURATION: {
    readonly type: "number";
  };
  readonly RATE_LIMITER_GLOBAL_EXEC_EVENLY: {
    readonly type: "boolean";
  };
  readonly RATE_LIMITER_GLOBAL_EXEC_EVENLY_MIN_DELAY_MS: {
    readonly type: "number";
  };
  readonly RATE_LIMITER_GLOBAL_IN_MEMORY_BLOCK_ON_CONSUMED: {
    readonly type: "number";
  };
  readonly RATE_LIMITER_GLOBAL_IN_MEMORY_BLOCK_DURATION: {
    readonly type: "number";
  };
  readonly RATE_LIMITER_REGISTRATION_KEY_PREFIX: {
    readonly type: "string";
  };
  readonly RATE_LIMITER_REGISTRATION_BLOCK_DURATION: {
    readonly type: "number";
  };
  readonly RATE_LIMITER_REGISTRATION_EXEC_EVENLY: {
    readonly type: "boolean";
  };
  readonly RATE_LIMITER_REGISTRATION_EXEC_EVENLY_MIN_DELAY_MS: {
    readonly type: "number";
  };
  readonly RATE_LIMITER_REGISTRATION_IN_MEMORY_BLOCK_ON_CONSUMED: {
    readonly type: "number";
  };
  readonly RATE_LIMITER_REGISTRATION_IN_MEMORY_BLOCK_DURATION: {
    readonly type: "number";
  };
};
/**
 * The variables of a named connection, location or provider, whose names hold
 * a part the deployment chooses: keyed by the glob of the name, each `*` one or
 * more characters. The first glob a name matches declares it, so the typed ones
 * come before the guessed, and the passthroughs a library reads last.
 */
declare const ENV_VAR_PATTERN_DECLARATIONS: {
  readonly 'DB_CONNECTION_*_PRIORITY': {
    readonly type: "number";
  };
  readonly 'DB_CONNECTION_*_PORT': {
    readonly type: "number";
  };
  readonly 'DB_CONNECTION_*_DATABASE': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_USER': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_PASSWORD': {
    readonly type: "string";
  };
  readonly DB_POOL__MIN: {
    readonly type: "number";
  };
  readonly DB_POOL__MAX: {
    readonly type: "number";
  };
  readonly 'DB_CONNECTION_*_POOL__MIN': {
    readonly type: "number";
  };
  readonly 'DB_CONNECTION_*_POOL__MAX': {
    readonly type: "number";
  };
  readonly 'DB_POOL__*_MILLIS': {
    readonly type: "number";
  };
  readonly 'DB_CONNECTION_*_POOL__*_MILLIS': {
    readonly type: "number";
  };
  readonly 'PGBOUNCER_*_ADMIN_HOSTS': {
    readonly type: "string[]";
  };
  readonly 'PGBOUNCER_*_ADMIN_DATABASE': {
    readonly type: "string";
  };
  readonly 'PGBOUNCER_*_ADMIN_USER': {
    readonly type: "string";
  };
  readonly 'PGBOUNCER_*_ADMIN_PASSWORD': {
    readonly type: "string";
  };
  readonly 'AUTH_*_BIND_PASSWORD': {
    readonly type: "string";
  };
  readonly 'STORAGE_*_SECRET': {
    readonly type: "string";
  };
  readonly 'WEBSOCKETS_*_ENABLED': {
    readonly type: "boolean";
  };
  readonly 'WEBSOCKETS_*_PATH': {
    readonly type: "string";
  };
  readonly 'WEBSOCKETS_*_AUTH': {
    readonly type: "string";
  };
  readonly 'WEBSOCKETS_*_AUTH_TIMEOUT': {
    readonly type: "number";
  };
  readonly 'WEBSOCKETS_*_CONN_LIMIT': {
    readonly type: "number";
  };
  readonly 'STORAGE_*_DRIVER': {
    readonly type: "string";
  };
  readonly 'STORAGE_*_ROOT': {
    readonly type: "string";
  };
  readonly 'STORAGE_*_KEY': {
    readonly type: "string";
  };
  readonly 'STORAGE_*_BUCKET': {
    readonly type: "string";
  };
  readonly 'STORAGE_*_REGION': {
    readonly type: "string";
  };
  readonly 'STORAGE_*_ENDPOINT': {
    readonly type: "string";
  };
  readonly 'STORAGE_*_ACL': {
    readonly type: "string";
  };
  readonly 'STORAGE_*_CONTAINER_NAME': {
    readonly type: "string";
  };
  readonly 'STORAGE_*_SERVER_SIDE_ENCRYPTION': {
    readonly type: "string";
  };
  readonly 'STORAGE_*_ACCOUNT_NAME': {
    readonly type: "string";
  };
  readonly 'STORAGE_*_ACCOUNT_KEY': {
    readonly type: "string";
  };
  readonly 'STORAGE_*_KEY_FILENAME': {
    readonly type: "string";
  };
  readonly 'STORAGE_*_FORCE_PATH_STYLE': {
    readonly type: "boolean";
  };
  readonly 'STORAGE_*_HEALTHCHECK_THRESHOLD': {
    readonly type: "number";
  };
  readonly 'AUTH_*_DRIVER': {
    readonly type: "string";
  };
  readonly 'AUTH_*_MODE': {
    readonly type: "string";
  };
  readonly 'AUTH_*_LOGIN_TIMEOUT': {
    readonly type: "number | string";
  };
  readonly 'AUTH_*_CLIENT_ID': {
    readonly type: "string";
  };
  readonly 'AUTH_*_CLIENT_SECRET': {
    readonly type: "string";
  };
  readonly 'AUTH_*_CLIENT_PRIVATE_KEYS': {
    readonly type: "json";
  };
  readonly 'AUTH_*_CLIENT_TOKEN_ENDPOINT_AUTH_METHOD': {
    readonly type: "string";
  };
  readonly 'AUTH_*_CLIENT__*': {};
  readonly 'AUTH_*_SCOPE': {
    readonly type: "string";
  };
  readonly 'AUTH_*_AUTHORIZE_URL': {
    readonly type: "string";
  };
  readonly 'AUTH_*_ACCESS_URL': {
    readonly type: "string";
  };
  readonly 'AUTH_*_PROFILE_URL': {
    readonly type: "string";
  };
  readonly 'AUTH_*_IDENTIFIER_KEY': {
    readonly type: "string";
  };
  readonly 'AUTH_*_EMAIL_KEY': {
    readonly type: "string";
  };
  readonly 'AUTH_*_FIRST_NAME_KEY': {
    readonly type: "string";
  };
  readonly 'AUTH_*_LAST_NAME_KEY': {
    readonly type: "string";
  };
  readonly 'AUTH_*_ALLOW_PUBLIC_REGISTRATION': {
    readonly type: "boolean";
  };
  readonly 'AUTH_*_DEFAULT_ROLE_ID': {
    readonly type: "string";
  };
  readonly 'AUTH_*_SYNC_USER_INFO': {
    readonly type: "boolean";
  };
  readonly 'AUTH_*_ICON': {
    readonly type: "string";
  };
  readonly 'AUTH_*_LABEL': {
    readonly type: "string";
  };
  readonly 'AUTH_*_PARAMS': {
    readonly type: "json";
  };
  readonly 'AUTH_*_ISSUER_URL': {
    readonly type: "string";
  };
  readonly 'AUTH_*_ISSUER_DISCOVERY_MUST_SUCCEED': {
    readonly type: "boolean";
  };
  readonly 'AUTH_*_CLIENT_HTTP_CA': {
    readonly type: "string";
  };
  readonly 'AUTH_*_CLIENT_HTTP_CERT': {
    readonly type: "string";
  };
  readonly 'AUTH_*_CLIENT_HTTP_CRL': {
    readonly type: "string";
  };
  readonly 'AUTH_*_CLIENT_HTTP_KEY': {
    readonly type: "string";
  };
  readonly 'AUTH_*_CLIENT_HTTP_PASSPHRASE': {
    readonly type: "string";
  };
  readonly 'AUTH_*_CLIENT_HTTP_PFX': {
    readonly type: "string";
  };
  readonly 'AUTH_*_CLIENT_HTTP_TIMEOUT': {
    readonly type: "number";
  };
  readonly 'AUTH_*_CLIENT_HTTP_*': {};
  readonly 'AUTH_*_REQUIRE_VERIFIED_EMAIL': {
    readonly type: "boolean";
  };
  readonly 'AUTH_*_PLAIN_CODE_CHALLENGE': {
    readonly type: "boolean";
  };
  readonly 'AUTH_*_GROUP_CLAIM_NAME': {
    readonly type: "string";
  };
  readonly 'AUTH_*_ROLE_MAPPING': {
    readonly type: "json";
  };
  readonly 'AUTH_*_GIVEN_NAME_KEY': {
    readonly type: "string";
  };
  readonly 'AUTH_*_FAMILY_NAME_KEY': {
    readonly type: "string";
  };
  readonly 'AUTH_*_CLIENT_URL': {
    readonly type: "string";
  };
  readonly 'AUTH_*_BIND_DN': {
    readonly type: "string";
  };
  readonly 'AUTH_*_USER_DN': {
    readonly type: "string";
  };
  readonly 'AUTH_*_USER_ATTRIBUTE': {
    readonly type: "string";
  };
  readonly 'AUTH_*_USER_SCOPE': {
    readonly type: "string";
  };
  readonly 'AUTH_*_MAIL_ATTRIBUTE': {
    readonly type: "string";
  };
  readonly 'AUTH_*_FIRST_NAME_ATTRIBUTE': {
    readonly type: "string";
  };
  readonly 'AUTH_*_LAST_NAME_ATTRIBUTE': {
    readonly type: "string";
  };
  readonly 'AUTH_*_GROUP_DN': {
    readonly type: "string";
  };
  readonly 'AUTH_*_GROUP_ATTRIBUTE': {
    readonly type: "string";
  };
  readonly 'AUTH_*_GROUP_SCOPE': {
    readonly type: "string";
  };
  readonly 'AUTH_*_IDP_METADATA': {
    readonly type: "string";
  };
  readonly 'AUTH_*_IDP_REQUEST_SIGNATURE_ALGORITHM': {
    readonly type: "string";
  };
  readonly 'AUTH_*_IDP_PRIVATE_KEY': {
    readonly type: "string";
  };
  readonly 'AUTH_*_IDP_PRIVATE_KEY_PASS': {
    readonly type: "string";
  };
  readonly 'AUTH_*_IDP_SIGNING_CERT': {
    readonly type: "string";
  };
  readonly 'AUTH_*_IDP_ENCRYPT_CERT': {
    readonly type: "string";
  };
  readonly 'AUTH_*_IDP_ENC_PRIVATE_KEY': {
    readonly type: "string";
  };
  readonly 'AUTH_*_IDP_ENC_PRIVATE_KEY_PASS': {
    readonly type: "string";
  };
  readonly 'AUTH_*_IDP_MESSAGE_SIGNING_ORDER': {
    readonly type: "string";
  };
  readonly 'AUTH_*_IDP_IS_ASSERTION_ENCRYPTED': {
    readonly type: "boolean";
  };
  readonly 'AUTH_*_IDP_WANT_LOGOUT_REQUEST_SIGNED': {
    readonly type: "boolean";
  };
  readonly 'AUTH_*_IDP_WANT_LOGOUT_RESPONSE_SIGNED': {
    readonly type: "boolean";
  };
  readonly 'AUTH_*_IDP_WANT_AUTHN_REQUESTS_SIGNED': {
    readonly type: "boolean";
  };
  readonly 'AUTH_*_IDP_WANT_LOGOUT_REQUEST_SIGNED_RESPONSE_SIGNED': {
    readonly type: "boolean";
  };
  readonly 'AUTH_*_SP_METADATA': {
    readonly type: "string";
  };
  readonly 'AUTH_*_SP_PRIVATE_KEY': {
    readonly type: "string";
  };
  readonly 'AUTH_*_SP_PRIVATE_KEY_PASS': {
    readonly type: "string";
  };
  readonly 'AUTH_*_SP_REQUEST_SIGNATURE_ALGORITHM': {
    readonly type: "string";
  };
  readonly 'AUTH_*_SP_ENC_PRIVATE_KEY': {
    readonly type: "string";
  };
  readonly 'AUTH_*_SP_ENC_PRIVATE_KEY_PASS': {
    readonly type: "string";
  };
  readonly 'AUTH_*_SP_SIGNING_CERT': {
    readonly type: "string";
  };
  readonly 'AUTH_*_SP_ENCRYPT_CERT': {
    readonly type: "string";
  };
  readonly 'AUTH_*_SP_RELAY_STATE': {
    readonly type: "string";
  };
  readonly 'AUTH_*_SP_AUTHN_REQUESTS_SIGNED': {
    readonly type: "boolean";
  };
  readonly 'AUTH_*_SP_WANT_ASSERTIONS_SIGNED': {
    readonly type: "boolean";
  };
  readonly 'AUTH_*_SP_WANT_MESSAGE_SIGNED': {
    readonly type: "boolean";
  };
  readonly 'AUTH_*_SP_WANT_LOGOUT_RESPONSE_SIGNED': {
    readonly type: "boolean";
  };
  readonly 'AUTH_*_SP_WANT_LOGOUT_REQUEST_SIGNED': {
    readonly type: "boolean";
  };
  readonly 'AUTH_*_SP_IS_ASSERTION_ENCRYPTED': {
    readonly type: "boolean";
  };
  readonly 'AUTH_*_SP_ALLOW_CREATE': {
    readonly type: "boolean";
  };
  readonly 'AUTH_*_SP_TRANSFORMATION_ALGORITHMS': {
    readonly type: "string[]";
  };
  readonly 'AUTH_*_IDP*': {};
  readonly 'AUTH_*_SP*': {};
  readonly 'AUTH_*_REDIRECT_ALLOW_LIST': {
    readonly type: "string[]";
  };
  readonly 'DB_CONNECTION_*_CLIENT': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_VERSION': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_HOST': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_FILENAME': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_CONNECTION_STRING': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_SEARCH_PATH': {
    readonly type: "string[]";
  };
  readonly 'DB_CONNECTION_*_APPLICATION_NAME': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_HEALTHCHECK_THRESHOLD': {
    readonly type: "number";
  };
  readonly 'DB_CONNECTION_*_KEEP_ALIVE': {
    readonly type: "boolean";
  };
  readonly 'DB_CONNECTION_*_KEEP_ALIVE_INITIAL_DELAY_MILLIS': {
    readonly type: "number";
  };
  readonly 'DB_CONNECTION_*_CONNECTION_TIMEOUT_MILLIS': {
    readonly type: "number";
  };
  readonly 'DB_CONNECTION_*_SSL__SECURE_OPTIONS': {
    readonly type: "number";
  };
  readonly 'DB_CONNECTION_*_OPTIONS': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_CHARSET': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_TIMEZONE': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_CONNECT_TIMEOUT': {
    readonly type: "number";
  };
  readonly 'DB_CONNECTION_*_SOCKET_PATH': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_SUPPORT_BIG_NUMBERS': {
    readonly type: "boolean";
  };
  readonly 'DB_CONNECTION_*_BIG_NUMBER_STRINGS': {
    readonly type: "boolean";
  };
  readonly 'DB_CONNECTION_*_DATE_STRINGS': {
    readonly type: "boolean";
  };
  readonly 'DB_CONNECTION_*_DECIMAL_NUMBERS': {
    readonly type: "boolean";
  };
  readonly 'DB_CONNECTION_*_POOL__PROPAGATE_CREATE_ERROR': {
    readonly type: "boolean";
  };
  readonly 'DB_CONNECTION_*_SSL': {
    readonly type: "boolean";
  };
  readonly DB_SSL__HOST: {
    readonly type: "string";
  };
  readonly DB_SSL__PATH: {
    readonly type: "string";
  };
  readonly DB_SSL__SERVERNAME: {
    readonly type: "string";
  };
  readonly DB_SSL__SIGALGS: {
    readonly type: "string";
  };
  readonly DB_SSL__CIPHERS: {
    readonly type: "string";
  };
  readonly DB_SSL__CLIENT_CERT_ENGINE: {
    readonly type: "string";
  };
  readonly DB_SSL__ECDH_CURVE: {
    readonly type: "string";
  };
  readonly DB_SSL__PRIVATE_KEY_ENGINE: {
    readonly type: "string";
  };
  readonly DB_SSL__PRIVATE_KEY_IDENTIFIER: {
    readonly type: "string";
  };
  readonly DB_SSL__MAX_VERSION: {
    readonly type: "string";
  };
  readonly DB_SSL__MIN_VERSION: {
    readonly type: "string";
  };
  readonly DB_SSL__PASSPHRASE: {
    readonly type: "string";
  };
  readonly DB_SSL__SECURE_PROTOCOL: {
    readonly type: "string";
  };
  readonly DB_SSL__SESSION_ID_CONTEXT: {
    readonly type: "string";
  };
  readonly DB_SSL__CA: {
    readonly type: "string";
  };
  readonly DB_SSL__CERT: {
    readonly type: "string";
  };
  readonly DB_SSL__CRL: {
    readonly type: "string";
  };
  readonly DB_SSL__DHPARAM: {
    readonly type: "string";
  };
  readonly DB_SSL__KEY: {
    readonly type: "string";
  };
  readonly DB_SSL__PFX: {
    readonly type: "string";
  };
  readonly DB_SSL__PORT: {
    readonly type: "number";
  };
  readonly DB_SSL__TIMEOUT: {
    readonly type: "number";
  };
  readonly DB_SSL__SECURE_OPTIONS: {
    readonly type: "number";
  };
  readonly DB_SSL__SESSION_TIMEOUT: {
    readonly type: "number";
  };
  readonly DB_SSL__ENABLE_TRACE: {
    readonly type: "boolean";
  };
  readonly DB_SSL__REQUEST_CERT: {
    readonly type: "boolean";
  };
  readonly DB_SSL__REJECT_UNAUTHORIZED: {
    readonly type: "boolean";
  };
  readonly DB_SSL__ALLOW_PARTIAL_TRUST_CHAIN: {
    readonly type: "boolean";
  };
  readonly DB_SSL__HONOR_CIPHER_ORDER: {
    readonly type: "boolean";
  };
  readonly 'DB_CONNECTION_*_SSL__HOST': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_SSL__PATH': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_SSL__SERVERNAME': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_SSL__SIGALGS': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_SSL__CIPHERS': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_SSL__CLIENT_CERT_ENGINE': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_SSL__ECDH_CURVE': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_SSL__PRIVATE_KEY_ENGINE': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_SSL__PRIVATE_KEY_IDENTIFIER': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_SSL__MAX_VERSION': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_SSL__MIN_VERSION': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_SSL__PASSPHRASE': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_SSL__SECURE_PROTOCOL': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_SSL__SESSION_ID_CONTEXT': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_SSL__CA': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_SSL__CERT': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_SSL__CRL': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_SSL__DHPARAM': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_SSL__KEY': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_SSL__PFX': {
    readonly type: "string";
  };
  readonly 'DB_CONNECTION_*_SSL__PORT': {
    readonly type: "number";
  };
  readonly 'DB_CONNECTION_*_SSL__TIMEOUT': {
    readonly type: "number";
  };
  readonly 'DB_CONNECTION_*_SSL__SESSION_TIMEOUT': {
    readonly type: "number";
  };
  readonly 'DB_CONNECTION_*_SSL__ENABLE_TRACE': {
    readonly type: "boolean";
  };
  readonly 'DB_CONNECTION_*_SSL__REQUEST_CERT': {
    readonly type: "boolean";
  };
  readonly 'DB_CONNECTION_*_SSL__REJECT_UNAUTHORIZED': {
    readonly type: "boolean";
  };
  readonly 'DB_CONNECTION_*_SSL__ALLOW_PARTIAL_TRUST_CHAIN': {
    readonly type: "boolean";
  };
  readonly 'DB_CONNECTION_*_SSL__HONOR_CIPHER_ORDER': {
    readonly type: "boolean";
  };
  readonly 'DB_SSL__*': {};
  readonly 'DB_CONNECTION_*_SSL__*': {};
  readonly 'CONTENT_SECURITY_POLICY_DIRECTIVES__*': {
    readonly type: "null | string[]";
  };
  readonly 'ASSETS_CONTENT_SECURITY_POLICY_DIRECTIVES__*': {
    readonly type: "null | string[]";
  };
};
//#endregion
//#region src/constants/env-types.d.ts
/**
 * Casting flags that are read from env var values. For example `number:1` is read as `1` instead of
 * `'1'`
 */
declare const ENV_TYPES: readonly ["string", "number", "regex", "array", "json", "boolean"];
/**
 * What a variable may be declared as: a cast flag's types, but `string[]` for
 * `array`, whose `array:` flag a `string[]` declaration accepts.
 */
declare const ENV_VAR_DECLARED_TYPES: readonly ["string", "number", "regex", "string[]", "json", "boolean", "false | number", "false | string", "false | string[]", "null | string[]", "number | string", "boolean | number | string | string[]"];
//#endregion
//#region src/types/env-type.d.ts
type EnvType = (typeof ENV_TYPES)[number];
type EnvVarDeclaredType = (typeof ENV_VAR_DECLARED_TYPES)[number];
//#endregion
//#region src/lib/cast.d.ts
/**
 * `value` cast by its prefix, else by `declaredType`, else by its guessed type:
 * a string declaration keeps `"0123"` as `"0123"`.
 */
declare const castEnvVarValue: (value: unknown, declaredType: EnvVarDeclaredType | null) => unknown;
//#endregion
//#region src/lib/read-env-var-file.d.ts
/**
 * The value the variable `fileEnvVarName` (a `NAME_FILE`) points to: the
 * content of the file at its path, behind the path's cast prefix if any.
 * Throws, naming the path and the variable, when the file cannot be read.
 */
declare const readEnvVarFile: (fileEnvVarName: string, fileEnvVarValue: string, declaredType: EnvVarDeclaredType | null) => string;
//#endregion
//#region src/types/env-var-declaration.d.ts
/** A list default is written `as const`, so a readonly list stands for one. */
type ReadonlyListOf<CastValue> = CastValue extends (infer Item)[] ? readonly Item[] : CastValue;
/**
 * What a variable is declared as: the type its value is cast to, the default it
 * takes when unset, already of that type, and the only values it may take when
 * `values` lists them.
 */
type EnvVarDeclaration = { [DeclaredType in EnvVarDeclaredType]: {
  type: DeclaredType;
  default?: ReadonlyListOf<EnvVarValueByType[DeclaredType]>;
  values?: readonly string[];
} }[EnvVarDeclaredType];
type EnvVarDeclarations = Record<string, EnvVarDeclaration>;
/**
 * A variable core reads whose value is guessed rather than cast to one type:
 * `false` or a value, a list or a word, or a passthrough a library reads.
 */
type GuessedEnvVarDeclaration = {
  type?: never;
  default?: unknown;
};
/** What core declares a variable as: a type, or a value it guesses. */
type CoreEnvVarDeclaration = EnvVarDeclaration | GuessedEnvVarDeclaration;
type CoreEnvVarDeclarations = Record<string, CoreEnvVarDeclaration>;
/** What a value of each type is once cast. */
type EnvVarValueByType = {
  string: string;
  number: number;
  boolean: boolean;
  regex: RegExp;
  'string[]': string[];
  json: unknown;
  'false | number': false | number;
  'false | string': false | string;
  'false | string[]': false | string[];
  'null | string[]': null | string[];
  'number | string': number | string;
  'boolean | number | string | string[]': boolean | number | string | string[];
};
type DeclaredEnvVarValue<Declaration extends CoreEnvVarDeclaration> = Declaration extends {
  values: readonly (infer Choice)[];
} ? Choice : Declaration extends {
  type: infer DeclaredType extends EnvVarDeclaredType;
} ? EnvVarValueByType[DeclaredType] : unknown;
/**
 * The variables `ExactDeclarations` declares, typed: a variable with a default
 * is always set, one without may be `undefined`.
 */
type DeclaredEnvVars<ExactDeclarations extends CoreEnvVarDeclarations> = { -readonly [VarName in keyof ExactDeclarations]: ExactDeclarations[VarName] extends {
  default: unknown;
} ? DeclaredEnvVarValue<ExactDeclarations[VarName]> : DeclaredEnvVarValue<ExactDeclarations[VarName]> | undefined };
/** The names a glob matches, each `*` standing for one or more characters. */
type EnvVarNamePattern<NamePattern$1 extends string> = NamePattern$1 extends `${infer Head}*${infer Tail}` ? `${Head}${string}${EnvVarNamePattern<Tail>}` : NamePattern$1;
/**
 * The variables `ExactDeclarations` declares by the glob of their name, typed:
 * one index signature per glob, never set by default.
 */
type PatternEnvVars<ExactDeclarations extends CoreEnvVarDeclarations> = { -readonly [NamePattern in keyof ExactDeclarations & string as EnvVarNamePattern<NamePattern>]: DeclaredEnvVarValue<ExactDeclarations[NamePattern]> | undefined };
//#endregion
//#region src/lib/check-declared-env-var-value.d.ts
/**
 * Why `envVarValue`, as set for the variable `envVarName`, does not fit
 * `envVarDeclaration`, or null when it does: a cast prefix naming another
 * type, a value its type cannot read, or one outside the declared `values`.
 */
declare const checkDeclaredEnvVarValue: (envVarName: string, envVarValue: unknown, envVarDeclaration: EnvVarDeclaration) => string | null;
//#endregion
//#region src/types/env.d.ts
/**
 * The variables core declares, each its declared type: a name core does not
 * declare is refused at typecheck.
 */
type Env = DeclaredEnvVars<typeof ENV_VAR_DECLARATIONS> & PatternEnvVars<typeof ENV_VAR_PATTERN_DECLARATIONS>;
/** A name core declares, literally or by the glob it matches. */
type EnvVarName = keyof Env & string;
//#endregion
//#region src/types/env-sources.d.ts
/**
 * Which layer of the loader supplied a variable's final value. The wire contract
 * `@directus/types` publishes for the processes report declares the same union;
 * assigning one to the other is what keeps the two from drifting silently.
 */
type EnvValueSource = 'default' | 'process' | 'file' | 'secret-file';
type EnvSources = Record<string, EnvValueSource>;
//#endregion
//#region src/lib/use-env.d.ts
declare const useEnv: () => Env;
/**
 * Which layer each resolved variable's value came from. Reads off the same
 * memoized build as `useEnv`, so it always describes the env in force.
 */
declare const useEnvSources: () => EnvSources;
/**
 * Each variable as it was set, before any cast, off the same build as
 * `useEnv`.
 */
declare const useEnvVarRawValues: () => Record<string, unknown>;
//#endregion
//#region src/utils/get-default-type.d.ts
declare const getDefaultType: (key: string | undefined) => EnvVarDeclaredType | null;
//#endregion
//#region src/utils/find-env-var-declaration.d.ts
/** What core declares `envVarName` as, or null when core declares nothing. */
declare const findEnvVarDeclaration: (envVarName: string) => CoreEnvVarDeclaration | null;
//#endregion
//#region src/constants/core-env-var-prefixes.d.ts
/**
 * The prefixes whose every variable is core's: one set under them that core
 * neither declares nor reads is a typo, and refuses the boot.
 *
 * Listed rather than read off the declared names, whose first words are often
 * shared: `PM2_` is also pm2's own (`PM2_HOME`), `SESSION_` a desktop's
 * (`SESSION_MANAGER`), and `REDIS_`, `EMAIL_`, `AUTH_` or `STORAGE_` hand
 * whatever follows them to a driver core does not list.
 */
declare const CORE_ENV_VAR_PREFIXES: readonly ["ASSETS_CONTENT_SECURITY_POLICY_", "CACHE_", "CONTENT_SECURITY_POLICY_", "CORS_", "DB_", "EXTENSIONS_", "FLOWS_", "GRAPHQL_", "HASH_", "HSTS_", "LOGGER_", "MARKETPLACE_", "METRICS_", "MIGRATIONS_", "PRESSURE_LIMITER_", "PROCESSES_", "QUERY_AUDIT_", "RATE_LIMITER_", "RETENTION_", "SERVER_", "TUS_", "WEBSOCKETS_"];
//#endregion
//#region src/utils/is-core-env-var-name.d.ts
/** Whether core declares the variable `envVarName`, literally or by a glob. */
declare const isCoreEnvVarName: (envVarName: string) => boolean;
//#endregion
export { CORE_ENV_VAR_PREFIXES, type CoreEnvVarDeclaration, type DeclaredEnvVarValue, type DeclaredEnvVars, ENV_VAR_DECLARATIONS, ENV_VAR_PATTERN_DECLARATIONS, type Env, type EnvSources, type EnvType, type EnvValueSource, type EnvVarDeclaration, type EnvVarDeclarations, type EnvVarDeclaredType, type EnvVarName, type EnvVarNamePattern, type EnvVarValueByType, type GuessedEnvVarDeclaration, castEnvVarValue, checkDeclaredEnvVarValue, findEnvVarDeclaration, getDefaultType, isCoreEnvVarName, readEnvVarFile, useEnv, useEnvSources, useEnvVarRawValues };