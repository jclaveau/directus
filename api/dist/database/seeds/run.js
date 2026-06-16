import { getHelpers } from "../helpers/index.js";
import path from "path";
import { isObject } from "lodash-es";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import fse from "fs-extra";
import yaml from "js-yaml";

//#region src/database/seeds/run.ts
const __dirname = dirname(fileURLToPath(import.meta.url));
async function runSeed(database) {
	const helpers = getHelpers(database);
	if (await database.schema.hasTable("directus_collections")) throw new Error("Database is already installed");
	const tableSeeds = await fse.readdir(path.resolve(__dirname));
	for (const tableSeedFile of tableSeeds) {
		if (tableSeedFile.startsWith("run")) continue;
		const yamlRaw = await fse.readFile(path.resolve(__dirname, tableSeedFile), "utf8");
		const seedData = yaml.load(yamlRaw);
		await database.schema.createTable(seedData.table, (tableBuilder) => {
			for (const [columnName, columnInfo] of Object.entries(seedData.columns)) {
				let column;
				if (columnInfo.type === "alias" || columnInfo.type === "unknown") return;
				if (columnInfo.type === "string") {
					let length = columnInfo.length;
					if (length === "MAX_TABLE_NAME_LENGTH") length = helpers.schema.getTableNameMaxLength();
					else if (length === "MAX_COLUMN_NAME_LENGTH") length = helpers.schema.getColumnNameMaxLength();
					column = tableBuilder.string(columnName, Number(length));
				} else if (columnInfo.increments) column = tableBuilder.increments();
				else if (columnInfo.type === "csv") column = tableBuilder.text(columnName);
				else if (columnInfo.type === "hash") column = tableBuilder.string(columnName, 255);
				else if (columnInfo.type?.startsWith("geometry")) column = helpers.st.createColumn(tableBuilder, {
					field: columnName,
					type: columnInfo.type
				});
				else column = tableBuilder[columnInfo.type](columnName);
				if (columnInfo.primary) column.primary();
				if (columnInfo.nullable !== void 0 && columnInfo.nullable === false) column.notNullable();
				if (columnInfo.default !== void 0) {
					let defaultValue = columnInfo.default;
					if (isObject(defaultValue) || Array.isArray(defaultValue)) defaultValue = JSON.stringify(defaultValue);
					if (defaultValue === "$now") defaultValue = database.fn.now();
					column.defaultTo(defaultValue);
				}
				if (columnInfo.unique) column.unique();
				if (columnInfo.unsigned) column.unsigned();
				if (columnInfo.references) column.references(columnInfo.references.column).inTable(columnInfo.references.table);
			}
		});
	}
}

//#endregion
export { runSeed as default };