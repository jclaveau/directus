import database_default from "../../../database/index.js";
import { getSchema } from "../../../utils/get-schema.js";
import "../../../services/index.js";
import { CollectionsService } from "../../../services/collections.js";
import { useEnv } from "@directus/env";
import { isSystemCollection } from "@directus/system-data";

//#region src/license/entitlements/lib/collections.ts
async function getActiveCollections(opts) {
	const env = useEnv();
	const knex = opts?.knex ?? database_default();
	return (await new CollectionsService({
		schema: await getSchema({ database: knex }),
		knex
	}).readByQuery()).filter((collection) => {
		const isFolder = collection.schema === null;
		const isDBOnly = collection.meta === null;
		const isDisabled = collection.meta?.status !== "active";
		const isEnvExcluded = env["DB_EXCLUDE_TABLES"].includes(collection.collection);
		return !isFolder && !isSystemCollection(collection.collection) && !isDBOnly && !isDisabled && !isEnvExcluded;
	}).map((collection) => collection.collection);
}
async function countActiveCollections(opts) {
	return (await getActiveCollections(opts)).length;
}
async function resolveCollections(collections, ctx) {
	const collectionsService = new CollectionsService({
		schema: await getSchema(),
		accountability: ctx?.accountability
	});
	await Promise.allSettled(collections.map((collection) => {
		return collectionsService.updateOne(collection, { meta: { status: "inactive" } });
	}));
}

//#endregion
export { countActiveCollections, getActiveCollections, resolveCollections };