import type { EnvType } from '../types/env-type.js';

/**
 * Environment variables that we expect to be in a certain type. Will set the default casting of
 * those values
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
	CACHE_SCHEMA: 'boolean',
	CACHE_STORE: 'string',
	CACHE_SKIP_ALLOWED: 'boolean',
	CACHE_AUTO_FLUSH_ON_DEPLOY: 'boolean',
	CACHE_BUILD_ID: 'string',
	CACHE_STATS_ENABLED: 'boolean',
	CACHE_STATS_RETENTION: 'string',
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

	IMPORT_IP_DENY_LIST: 'array',

	FILE_METADATA_ALLOW_LIST: 'array',

	GRAPHQL_INTROSPECTION: 'boolean',
	GRAPHQL_SCHEMA_GENERATION_MAX_CONCURRENT: 'number',

	MAX_BATCH_MUTATION: 'number',

	SERVER_SHUTDOWN_TIMEOUT: 'number',

	LOG_HTTP_IGNORE_PATHS: 'array',

	REDIS_ENABLED: 'boolean',

	METRICS_TOKENS: 'array',
	METRICS_SERVICES: 'array',

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

	DB_SSL__CA_FILE: 'string',

	ADMIN_PASSWORD: 'string',
	ADMIN_TOKEN: 'string',
	KEY: 'string',
	SECRET: 'string',

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
