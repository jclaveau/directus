//#region src/database/migrations/20211103B-update-special-geometry.ts
async function up(knex) {
	await knex("directus_fields").update({ special: knex.raw(`REPLACE(??, 'geometry,', 'geometry.')`, ["special"]) }).where("special", "like", "%geometry,Point%").orWhere("special", "like", "%geometry,LineString%").orWhere("special", "like", "%geometry,Polygon%").orWhere("special", "like", "%geometry,MultiPoint%").orWhere("special", "like", "%geometry,MultiLineString%").orWhere("special", "like", "%geometry,MultiPolygon%");
}
async function down(knex) {
	await knex("directus_fields").update({ special: knex.raw(`REPLACE(??, 'geometry.', 'geometry,')`, ["special"]) }).where("special", "like", "%geometry.Point%").orWhere("special", "like", "%geometry.LineString%").orWhere("special", "like", "%geometry.Polygon%").orWhere("special", "like", "%geometry.MultiPoint%").orWhere("special", "like", "%geometry.MultiLineString%").orWhere("special", "like", "%geometry.MultiPolygon%");
}

//#endregion
export { down, up };