//#region src/telemetry/utils/get-project-id.ts
const getProjectId = async (db) => {
	return (await db.select("project_id").from("directus_settings").first())?.project_id || null;
};

//#endregion
export { getProjectId };