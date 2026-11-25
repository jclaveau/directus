import type { Field, RawField } from '@directus/types';
import type { Knex } from 'knex';
import type { GeoJSONGeometry } from 'wellknown';
import { GeometryHelper } from '../types.js';

export class GeometryHelperOracle extends GeometryHelper {
	override isTrue(expression: Knex.Raw) { // bb-out-of-scope: #610 non-Postgres
		return expression.wrap(``, ` = 'TRUE'`);
	}

	override isFalse(expression: Knex.Raw) { // bb-out-of-scope: #610 non-Postgres
		return expression.wrap(``, ` = 'FALSE'`);
	}

	override createColumn(table: Knex.CreateTableBuilder, field: RawField | Field) { // bb-out-of-scope: #610 non-Postgres
		if (field.type.split('.')[1]) {
			field.meta!.special = [field.type];
		}

		return table.specificType(field.field, 'sdo_geometry');
	}

	override asText(table: string, column: string, alias: string | false): Knex.Raw { // bb-out-of-scope: #610 non-Postgres
		if (alias) return this.knex.raw('sdo_util.to_wktgeometry(??.??) as ??', [table, column, alias]);
		return this.knex.raw('sdo_util.to_wktgeometry(??.??)', [table, column]);
	}

	asGeoJSON(table: string, column: string): Knex.Raw { // bb-out-of-scope: #610 non-Postgres
		return this.knex.raw('sdo_util.to_geojson(??.??) as ??', [table, column, column]);
	}

	override fromText(text: string): Knex.Raw { // bb-out-of-scope: #610 non-Postgres
		return this.knex.raw('sdo_geometry(?, 4326)', text);
	}

	override _intersects(key: string, geojson: GeoJSONGeometry): Knex.Raw { // bb-out-of-scope: #610 non-Postgres
		const geometry = this.fromGeoJSON(geojson);
		return this.knex.raw(`sdo_overlapbdyintersect(??, ?)`, [key, geometry]);
	}

	override _intersects_bbox(key: string, geojson: GeoJSONGeometry): Knex.Raw { // bb-out-of-scope: #610 non-Postgres
		const geometry = this.fromGeoJSON(geojson);
		return this.knex.raw(`sdo_overlapbdyintersect(sdo_geom.sdo_mbr(??), sdo_geom.sdo_mbr(?))`, [key, geometry]);
	}

	override collect(table: string, column: string): Knex.Raw { // bb-out-of-scope: #610 non-Postgres
		return this.knex.raw(`concat('geometrycollection(', listagg(?, ', '), ')'`, this.asText(table, column, column));
	}
}
