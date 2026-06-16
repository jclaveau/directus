import { InvalidQueryError } from "@directus/errors";
import { getRelationInfo } from "@directus/utils";
import { isPlainObject } from "lodash-es";
import assert from "node:assert";

//#region src/utils/deep-map-response.ts
/**
* Allows to deep map the response from the ItemsService with collection, field and relation context for each entry.
* Bottom to Top depth first mapping of values.
*/
function deepMapResponse(object, callback, context) {
	const collection = context.schema.collections[context.collection];
	assert(isPlainObject(object) && typeof object === "object" && object !== null, `DeepMapResponse only works on objects, received ${JSON.stringify(object)}`);
	return Object.fromEntries(Object.entries(object).map(([key, value]) => {
		const field = collection?.fields[key];
		if (!field) return [key, value];
		const relationInfo = getRelationInfo(context.schema.relations, collection.collection, field.field);
		let leaf = true;
		if (relationInfo.relation && typeof value === "object" && value !== null && isPlainObject(object)) switch (relationInfo.relationType) {
			case "m2o":
				value = deepMapResponse(value, callback, {
					schema: context.schema,
					collection: relationInfo.relation.related_collection,
					relationInfo
				});
				leaf = false;
				break;
			case "o2m":
				value = value.map((childValue) => {
					if (isPlainObject(childValue) && typeof childValue === "object" && childValue !== null) {
						leaf = false;
						return deepMapResponse(childValue, callback, {
							schema: context.schema,
							collection: relationInfo.relation.collection,
							relationInfo
						});
					} else return childValue;
				});
				break;
			case "a2o": {
				const related_collection = object[relationInfo.relation.meta.one_collection_field];
				if (!related_collection) throw new InvalidQueryError({ reason: `When selecting '${collection.collection}.${field.field}', the field '${collection.collection}.${relationInfo.relation.meta.one_collection_field}' has to be selected when using versioning and m2a relations ` });
				value = deepMapResponse(value, callback, {
					schema: context.schema,
					collection: related_collection,
					relationInfo
				});
				leaf = false;
				break;
			}
		}
		return callback([key, value], {
			collection,
			field,
			...relationInfo,
			leaf
		});
	}));
}

//#endregion
export { deepMapResponse };