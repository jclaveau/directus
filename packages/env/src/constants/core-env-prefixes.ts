/**
 * The prefixes whose every variable is core's: one set under them that core
 * neither declares nor reads is a typo, and is warned about at boot.
 *
 * Listed rather than read off the declared names, whose first words are often
 * shared: `PM2_` is also pm2's own (`PM2_HOME`), `SESSION_` a desktop's
 * (`SESSION_MANAGER`), and `REDIS_`, `EMAIL_`, `AUTH_` or `STORAGE_` hand
 * whatever follows them to a driver core does not list.
 */
export const CORE_ENV_PREFIXES = [
	'ASSETS_CONTENT_SECURITY_POLICY_',
	'CACHE_',
	'CONTENT_SECURITY_POLICY_',
	'CORS_',
	'DB_',
	'EXTENSIONS_',
	'FLOWS_',
	'GRAPHQL_',
	'HASH_',
	'HSTS_',
	'LOGGER_',
	'MARKETPLACE_',
	'METRICS_',
	'MIGRATIONS_',
	'PRESSURE_LIMITER_',
	'PROCESSES_',
	'QUERY_AUDIT_',
	'RATE_LIMITER_',
	'RETENTION_',
	'SERVER_',
	'TUS_',
	'WEBSOCKETS_',
] as const;
