import "knex";

//#region src/telemetry/utils/get-filesize-sum.ts
const getFilesizeSum = async (db) => {
	const query = await db.sum({ total: "filesize" }).from("directus_files").first();
	return { total: query?.total ? Number(query.total) : 0 };
};

//#endregion
export { getFilesizeSum };