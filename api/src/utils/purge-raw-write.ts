import type { SchemaOverview } from '@directus/types';
import type { Knex } from 'knex';
import {
	createScopedCacheExtensionHandle,
} from '../extensions/lib/scoped-cache-handle.js';
import { useLogger } from '../logger/index.js';
import { queueAfterCommit } from './transaction.js';

/**
 * Purge the slices of rows written through raw knex: no hook hears such a write.
 * Waits for the transaction `knex` belongs to, if any, to commit.
 *
 * A failure is logged, not thrown: the write has landed by then, as for a purge
 * drained after a commit.
 */
export async function purgeRawWrite(
	knex: Knex,
	schema: SchemaOverview,
	collection: string,
	mutatedRows: Record<string, unknown>[],
): Promise<void> {
	const purgeMutatedRows = async () => {
		await createScopedCacheExtensionHandle(async () => schema)
			.purgeForMutatedRows(collection, mutatedRows);
	};

	if (queueAfterCommit(knex, purgeMutatedRows)) {
		return;
	}

	try {
		await purgeMutatedRows();
	}
	catch (error) {
		useLogger().error(
			error,
			`[purge-raw-write] purging the rows a raw write left in ${collection} `
			+ `failed: ${error}`,
		);
	}
}
