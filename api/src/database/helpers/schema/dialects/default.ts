import type { Knex } from 'knex';
import { SchemaHelper } from '../types.js';

export class SchemaHelperDefault extends SchemaHelper {
	// Redshift has no DROP ... IF EXISTS syntax and no real secondary indexes; knex's native
	// dropUniqueIfExists throws on redshift. Fall back to the plain drops (pre-#35 behavior).
	override async dropUniqueIfExists(knex: Knex, collection: string, field: string): Promise<void> {
		const constraintName = this.generateIndexName('unique', collection, field);

		await knex.schema.alterTable(collection, (table) => {
			table.dropUnique([field], constraintName);
		});
	}

	override async dropIndexIfExists(knex: Knex, collection: string, field: string): Promise<void> {
		const indexName = this.generateIndexName('index', collection, field);

		await knex.schema.alterTable(collection, (table) => {
			table.dropIndex([field], indexName);
		});
	}
}
