import type { Knex } from 'knex';
import { DatabaseHelper } from '../types.js';

export class AutoSequenceHelper extends DatabaseHelper {
	async resetAutoIncrementSequence(_table: string, _column: string): Promise<Knex.Raw | void> {
		return;
	}

	/**
	 * Raises the auto increment sequence so the next value it hands out sits above
	 * `providedValue`. Engines that advance the counter on an explicit insert of their
	 * own accord, such as MySQL and SQLite, need nothing here.
	 */
	async raiseAutoIncrementSequence(
		_table: string,
		_column: string,
		_providedValue: number,
	): Promise<Knex.Raw | void> {
		return;
	}
}
