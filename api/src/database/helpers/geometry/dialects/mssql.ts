import type { Field, RawField } from '@directus/types';
import type { Knex } from 'knex';
import type { GeoJSONGeometry } from 'wellknown';
import { GeometryHelper } from '../types.js';

export class GeometryHelperMSSQL extends GeometryHelper {
	override isTrue(expression: Knex.Raw) { // bb-out-of-scope: #610 non-Postgres
		return expression.wrap(``, ` = 1`);
	}

	override isFalse(expression: Knex.Raw) { // bb-out-of-scope: #610 non-Postgres
		return expression.wrap(``, ` = 0`);
	}

	override createColumn(table: Knex.CreateTableBuilder, field: RawField | Field) { // bb-out-of-scope: #610 non-Postgres
		if (field.type.split('.')[1]) {
			field.meta!.special = [field.type];
		}

		return table.specificType(field.field, 'geometry');
	}

	override asText(table: string, column: string, alias: string | false): Knex.Raw { // bb-out-of-scope: #610 non-Postgres
		if (alias) return this.knex.raw('??.??.STAsText() as ??', [table, column, alias]);
		return this.knex.raw('??.??.STAsText()', [table, column]);
	}

	override fromText(text: string): Knex.Raw { // bb-out-of-scope: #610 non-Postgres
		return this.knex.raw('geometry::STGeomFromText(?, 4326)', text);
	}

	override _intersects(key: string, geojson: GeoJSONGeometry): Knex.Raw { // bb-out-of-scope: #610 non-Postgres
		const geometry = this.fromGeoJSON(geojson);
		return this.knex.raw('??.STIntersects(?)', [key, geometry]);
	}

	override _intersects_bbox(key: string, geojson: GeoJSONGeometry): Knex.Raw { // bb-out-of-scope: #610 non-Postgres
		const geometry = this.fromGeoJSON(geojson);
		return this.knex.raw('??.STEnvelope().STIntersects(?.STEnvelope())', [key, geometry]);
	}

	override collect(table: string, column: string): Knex.Raw { // bb-out-of-scope: #610 non-Postgres
		return this.knex.raw('geometry::CollectionAggregate(??.??).STAsText()', [table, column]);
	}
}
