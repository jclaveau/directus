import "../config.js";
import "../logger.js";
import { apiFolder } from "../sandbox.js";
import { spawn } from "child_process";
import { join, resolve } from "path";
import chalk from "chalk";
import { camelCase, upperFirst } from "lodash-es";
import { getRelationInfo } from "@directus/utils";
import { writeFile } from "fs/promises";

//#region src/steps/schema.ts
async function loadSchema(schema_file, env, logger) {
	const start = performance.now();
	logger.info("Applying Schema");
	const schema = spawn("node", [
		join(apiFolder, "dist", "cli", "run.js"),
		"schema",
		"apply",
		"-y",
		resolve(schema_file)
	], { env });
	schema.on("error", (err) => {
		schema.kill();
		throw err;
	});
	logger.pipe(schema.stdout, "debug");
	logger.pipe(schema.stderr, "error");
	await new Promise((resolve$1) => schema.on("close", resolve$1));
	const time = chalk.gray(`(${Math.round(performance.now() - start)}ms)`);
	logger.info(`Schema Applied ${time}`);
}
async function saveSchema(env) {
	return setInterval(async () => {
		const snapshot = await (await fetch(`${env.PUBLIC_URL}/schema/snapshot?access_token=${env.ADMIN_TOKEN}`)).json();
		const collections = snapshot.data.collections.filter((collection) => collection.schema);
		await writeFile("schema.d.ts", `export type Schema = {
	${collections.map((collection) => {
			const collectionName = formatCollection(collection.collection);
			if (collection.meta?.singleton) return `${formatField(collection.collection)}: ${collectionName}`;
			return `${formatField(collection.collection)}: ${collectionName}[];`;
		}).join("\n	")}
};
` + collections.map((collection) => {
			return `export type ${formatCollection(collection.collection)} = {
	${snapshot.data.fields.filter((field) => field.collection === collection.collection).map((field) => {
				const { relation, relationType } = getRelationInfo(snapshot.data.relations, collection.collection, field.field);
				const optional = field.schema?.is_nullable || field.schema?.is_generated || field.schema?.is_primary_key;
				const fieldName = `${formatField(field.field)}${optional ? "?" : ""}:`;
				if (!relation || !relationType) return `${fieldName} string | number;`;
				if (relationType === "o2m") return `${fieldName} (string | number | ${formatCollection(relation.collection)})[];`;
				else if (relationType === "m2o") return `${fieldName} string | number | ${formatCollection(relation.related_collection)};`;
				else return `${fieldName} string | number | ${relation.meta.one_allowed_collections.map(formatCollection).join(" | ")};`;
			}).join("\n	")}
};`;
		}).join("\n"));
		await writeFile("snapshot.json", JSON.stringify(snapshot.data, null, 4));
	}, 2e3);
}
function formatCollection(title) {
	return upperFirst(camelCase(title.replaceAll("_1234", "")));
}
function formatField(title) {
	return title.replaceAll("_1234", "");
}

//#endregion
export { loadSchema, saveSchema };