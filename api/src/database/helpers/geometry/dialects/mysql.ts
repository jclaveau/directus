import type { Knex } from 'knex';
import { GeometryHelper } from '../types.js';

export class GeometryHelperMySQL extends GeometryHelper {
	override collect(table: string, column: string): Knex.Raw { // bb-out-of-scope: #610 non-Postgres
		return this.knex.raw(
			`concat('geometrycollection(', group_concat(? separator ', '), ')'`,
			this.asText(table, column, column),
		);
	}

	override fromText(text: string): Knex.Raw { // bb-out-of-scope: #610 non-Postgres
		return this.knex.raw('st_geomfromtext(?)', text);
	}

	asGeoJSON(table: string, column: string): Knex.Raw { // bb-out-of-scope: #610 non-Postgres
		return this.knex.raw('st_asgeojson(??.??) as ??', [table, column, column]);
	}
}
