import database_default, { getDatabaseClient } from "../database/index.js";
import { RelationsService } from "../services/relations.js";
import { getSchema } from "./get-schema.js";
import { sanitizeCollection, sanitizeField, sanitizeRelation, sanitizeSystemField } from "./sanitize-schema.js";
import { FieldsService } from "../services/fields.js";
import { CollectionsService } from "../services/collections.js";
import { fromPairs, isArray, isPlainObject, mapValues, omit, sortBy, toPairs } from "lodash-es";
import { version } from "directus/version";

//#region src/utils/get-snapshot.ts
async function getSnapshot(options) {
	const database = options?.database ?? database_default();
	const vendor = getDatabaseClient(database);
	const schema = options?.schema ?? await getSchema({
		database,
		bypassCache: true
	});
	const collectionsService = new CollectionsService({
		knex: database,
		schema
	});
	const fieldsService = new FieldsService({
		knex: database,
		schema
	});
	const relationsService = new RelationsService({
		knex: database,
		schema
	});
	const [collectionsRaw, fieldsRaw, relationsRaw] = await Promise.all([
		collectionsService.readByQuery(),
		fieldsService.readAll(),
		relationsService.readAll()
	]);
	const collectionsFiltered = collectionsRaw.filter((item) => excludeSystem(item) && excludeUntracked(item));
	const fieldsFiltered = fieldsRaw.filter((item) => excludeSystem(item) && excludeUntracked(item));
	const relationsFiltered = relationsRaw.filter((item) => excludeSystem(item) && excludeUntracked(item));
	const systemFieldsFiltered = fieldsRaw.filter((item) => systemFieldWithIndex(item));
	return {
		version: 1,
		directus: version,
		vendor,
		collections: sortBy(mapValues(collectionsFiltered, sortDeep), ["collection"]).map((collection) => sanitizeCollection(collection)),
		fields: sortBy(mapValues(fieldsFiltered, sortDeep), ["collection", "meta.id"]).map((field) => sanitizeField(omitID(field))),
		systemFields: sortBy(systemFieldsFiltered, ["collection", "field"]).map((field) => sanitizeSystemField(field)),
		relations: sortBy(mapValues(relationsFiltered, sortDeep), ["collection", "meta.id"]).map((relation) => sanitizeRelation(omitID(relation)))
	};
}
function excludeSystem(item) {
	if (item?.meta?.system === true) return false;
	return true;
}
function systemFieldWithIndex(item) {
	return item.meta?.system === true && item.schema?.is_indexed;
}
function excludeUntracked(item) {
	if (item?.meta === null) return false;
	return true;
}
function omitID(item) {
	return omit(item, "meta.id");
}
function sortDeep(raw) {
	if (isPlainObject(raw)) return fromPairs(sortBy(toPairs(mapValues(raw, sortDeep))));
	if (isArray(raw)) return raw.map((raw$1) => sortDeep(raw$1));
	return raw;
}

//#endregion
export { getSnapshot };