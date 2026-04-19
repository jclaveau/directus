import "knex";

//#region src/telemetry/utils/get-field-count.ts
const getFieldCount = async (db) => {
	const query = await db.max({ max: "field_count" }).sum({ total: "field_count" }).from(db.select("collection").count("* as field_count").from("directus_fields").groupBy("collection").as("inner")).first();
	return {
		max: query?.max ? Number(query.max) : 0,
		total: query?.total ? Number(query.total) : 0
	};
};

//#endregion
export { getFieldCount };