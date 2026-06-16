import { parseJSON } from "@directus/utils";
import { assign } from "lodash-es";

//#region src/database/migrations/20240924B-populate-versioning-deltas.ts
async function up(knex) {
	const rowsLimit = 50;
	let hasMore = true;
	while (hasMore) {
		const missingDeltaVersions = await knex.select("id").from("directus_versions").whereNull("delta").limit(rowsLimit);
		if (missingDeltaVersions.length === 0) {
			hasMore = false;
			break;
		}
		await knex.transaction(async (trx) => {
			for (const missingDeltaVersion of missingDeltaVersions) {
				const consolidatedDelta = assign({}, ...(await trx.select("delta").from("directus_revisions").where("version", "=", missingDeltaVersion.id).orderBy("id")).map((revision) => typeof revision.delta === "string" ? parseJSON(revision.delta) : revision.delta ?? {}));
				await trx("directus_versions").update({ delta: JSON.stringify(consolidatedDelta) }).where("id", "=", missingDeltaVersion.id);
			}
		});
	}
}
async function down() {}

//#endregion
export { down, up };