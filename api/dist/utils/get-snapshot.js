import database_default, { getDatabaseClient } from "../database/index.js";
import { RelationsService } from "../services/relations.js";
import { getSchema } from "./get-schema.js";
import { sanitizeCollection, sanitizeField, sanitizeRelation } from "./sanitize-schema.js";
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
	const collectionsFiltered = collectionsRaw.filter((item) => excludeSystem(item));
	const fieldsFiltered = fieldsRaw.filter((item) => excludeSystem(item));
	const relationsFiltered = relationsRaw.filter((item) => excludeSystem(item));
	const collectionsSorted = sortBy(mapValues(collectionsFiltered, sortDeep), ["collection"]);
	const fieldsSorted = sortBy(mapValues(fieldsFiltered, sortDeep), ["collection", "meta.id"]).map(omitID);
	const relationsSorted = sortBy(mapValues(relationsFiltered, sortDeep), ["collection", "meta.id"]).map(omitID);
	return {
		version: 1,
		directus: version,
		vendor,
		collections: collectionsSorted.map((collection) => sanitizeCollection(collection)),
		fields: fieldsSorted.map((field) => sanitizeField(field)),
		relations: relationsSorted.map((relation) => sanitizeRelation(relation))
	};
}
function excludeSystem(item) {
	if (item?.meta?.system === true) return false;
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