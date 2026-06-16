import { getHelpers } from "../helpers/index.js";
import { resolvePackage } from "@directus/utils/node";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

//#region src/database/migrations/20240204A-marketplace.ts
const __dirname = dirname(fileURLToPath(import.meta.url));
async function up(knex) {
	await knex.schema.alterTable("directus_extensions", (table) => {
		table.uuid("id").nullable();
		table.string("folder");
		table.string("source");
		table.uuid("bundle");
	});
	const installedExtensions = await knex.select("name").from("directus_extensions");
	const idMap = /* @__PURE__ */ new Map();
	for (const { name } of installedExtensions) if (name.includes(":")) await knex("directus_extensions").delete().where({ name });
	else {
		const id = randomUUID();
		let source;
		try {
			resolvePackage(name, __dirname);
			source = "module";
		} catch {
			source = "local";
		}
		await knex("directus_extensions").update({
			id,
			source,
			folder: name
		}).where({ name });
		idMap.set(name, {
			id,
			source
		});
	}
	for (const { name } of installedExtensions) {
		if (!name.includes("/")) continue;
		const splittedName = name.split("/");
		const isScopedModuleBundleParent = name.startsWith("@") && splittedName.length == 2;
		if (isScopedModuleBundleParent) continue;
		const isScopedModuleBundleChild = name.startsWith("@") && splittedName.length > 2;
		const bundleParentName = isScopedModuleBundleParent || isScopedModuleBundleChild ? splittedName.slice(0, 2).join("/") : splittedName[0];
		const bundleParent = idMap.get(bundleParentName);
		if (!bundleParent) continue;
		await knex("directus_extensions").update({
			bundle: bundleParent.id,
			folder: name.substring(bundleParentName.length + 1),
			source: bundleParent.source
		}).where({ folder: name });
	}
	await knex.schema.alterTable("directus_extensions", (table) => {
		table.uuid("id").alter().notNullable();
	});
	await knex.transaction(async (trx) => {
		await getHelpers(trx).schema.changePrimaryKey("directus_extensions", ["id"]);
	});
	await knex.schema.alterTable("directus_extensions", (table) => {
		table.dropColumn("name");
		table.string("source").alter().notNullable();
		table.string("folder").alter().notNullable();
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_extensions", (table) => {
		table.string("name");
	});
	const installedExtensions = await knex.select([
		"id",
		"folder",
		"bundle",
		"source"
	]).from("directus_extensions");
	const idMap = new Map(installedExtensions.map((extension) => [extension.id, extension.folder]));
	for (const { id, folder, bundle, source } of installedExtensions) {
		if (source === "registry") {
			await knex("directus_extensions").delete().where({ id });
			continue;
		}
		let name = folder;
		if (bundle) name = `${idMap.get(bundle)}/${name}`;
		await knex("directus_extensions").update({ name }).where({ id });
	}
	await knex.transaction(async (trx) => {
		await getHelpers(trx).schema.changePrimaryKey("directus_extensions", ["name"]);
	});
	await knex.schema.alterTable("directus_extensions", (table) => {
		table.dropColumns("id", "folder", "source", "bundle");
		table.string("name").alter().notNullable();
	});
}

//#endregion
export { down, up };