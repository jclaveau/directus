import type { Field, RawField } from '@directus/types';
import type { Knex } from 'knex';
import { GeometryHelper } from '../types.js';

export class GeometryHelperRedshift extends GeometryHelper {
	override createColumn(table: Knex.CreateTableBuilder, field: RawField | Field) { // bb-out-of-scope: #610 non-Postgres
		if (field.type.split('.')[1]) {
			field.meta!.special = [field.type];
		}

		return table.specificType(field.field, 'geometry');
	}

	asGeoJSON(table: string, column: string): Knex.Raw { // bb-out-of-scope: #610 non-Postgres
		return this.knex.raw('st_asgeojson(??.??) as ??', [table, column, column]);
	}
}
