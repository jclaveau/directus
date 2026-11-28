//#region src/database/migrations/20261017A-hold-one-file-per-disk-name.ts
const TABLE = "directus_files";
const INDEX_NAME = "directus_files_filename_disk_unique";
/**
* One file per disk name, held by the database. The service reads before it
* writes, so two requests sent together both pass its check, and the two rows
* then share one file: deleting either deletes the other's.
*
* An instance already holding a duplicate is refused rather than repaired:
* which row owns the stored file is its owner's call, not a migration's.
*/
async function up(knex) {
	const duplicatedNames = knex.select("filename_disk").from(TABLE).whereNotNull("filename_disk").groupBy("filename_disk").havingRaw("count(*) > 1").as("duplicated");
	const duplicateRows = await knex.select("file.id", "file.filename_disk").from({ file: TABLE }).join(duplicatedNames, "file.filename_disk", "duplicated.filename_disk").orderBy("file.filename_disk").orderBy("file.id");
	if (duplicateRows.length > 0) {
		const idsByName = /* @__PURE__ */ new Map();
		for (const { id, filename_disk } of duplicateRows) idsByName.set(filename_disk, [...idsByName.get(filename_disk) ?? [], id]);
		const nameList = [...idsByName].map(([diskName, rowIds]) => {
			return `"${diskName}" (rows ${rowIds.join(", ")})`;
		}).join(", ");
		throw new Error(`${TABLE} holds more than one file for the disk name ${nameList}. Give each extra row its own file, or delete it, then run the migrations again.`);
	}
	await knex.schema.alterTable(TABLE, (table) => {
		table.unique(["filename_disk"], { indexName: INDEX_NAME });
	});
}
async function down(knex) {
	await knex.schema.alterTable(TABLE, (table) => {
		table.dropUnique(["filename_disk"], INDEX_NAME);
	});
}

//#endregion
export { down, up };