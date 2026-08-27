import type { Item } from '@directus/types';
import type { Knex } from 'knex';
import type { AST } from '../../types/ast.js';

export interface RunASTOptions {
	/**
	 * Query override for the current level
	 */
	query?: AST['query'];

	/**
	 * Knex instance
	 */
	knex?: Knex;

	/**
	 * Whether or not the current execution is a nested dataset in another AST
	 */
	nested?: boolean;

	/**
	 * Whether or not to strip out non-requested required fields automatically (eg IDs / FKs)
	 */
	stripNonRequested?: boolean;

	/**
	 * Read the rows while the keys injected for the nesting are still on them.
	 * Called once, at the top level, before `stripNonRequested` takes them away —
	 * a caller that scopes its cache entry BY those keys has nowhere else to see
	 * them, and this keeps the strip a single call site.
	 */
	onRowsWithTemporaryFields?: (rows: Item | Item[]) => void;
}
