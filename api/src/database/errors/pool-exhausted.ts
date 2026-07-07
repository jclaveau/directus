import type { DatabasePoolExhaustedReason } from '@directus/errors';
import type { DatabaseClient } from '@directus/types';
import { getPoolExhaustedReason as postgres } from './dialects/postgres.js';

/**
 * Classify a raw driver/pool error as a pool-exhaustion reason, or null. pgbouncer fronts only
 * postgres, so only the postgres dialect (also used for cockroachdb) detects these; every other
 * dialect keeps its existing error handling.
 */
export function getDatabasePoolExhaustedReason(
	error: unknown,
	client: DatabaseClient | undefined,
): DatabasePoolExhaustedReason | null {
	switch (client) {
		case 'cockroachdb':
		case 'postgres':
			return postgres(error);
		default:
			return null;
	}
}
