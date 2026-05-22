import { getRelationType } from "./get-relation-type.js";
import { getRelation } from "@directus/utils";

//#region src/utils/get-relation-info.ts
function checkImplicitRelation(field) {
	if (field.startsWith("$FOLLOW(") && field.endsWith(")")) return field.slice(8, -1).split(",");
	return null;
}
function getRelationInfo(relations, collection, field) {
	if (field.startsWith("$FOLLOW") && field.length > 500) throw new Error(`Implicit $FOLLOW statement is too big to parse. Got: "${field.substring(500)}..."`);
	const implicitRelation = checkImplicitRelation(field);
	if (implicitRelation) if (implicitRelation[2] === void 0) {
		const [m2oCollection, m2oField] = implicitRelation;
		return {
			relation: {
				collection: m2oCollection.trim(),
				field: m2oField.trim(),
				related_collection: collection,
				schema: null,
				meta: null
			},
			relationType: "o2m"
		};
	} else {
		const [a2oCollection, a2oItemField, a2oCollectionField] = implicitRelation;
		return {
			relation: {
				collection: a2oCollection.trim(),
				field: a2oItemField.trim(),
				related_collection: collection,
				schema: null,
				meta: { one_collection_field: a2oCollectionField.trim() }
			},
			relationType: "o2a"
		};
	}
	const relation = getRelation(relations, collection, field) ?? null;
	return {
		relation,
		relationType: relation ? getRelationType({
			relation,
			collection,
			field
		}) : null
	};
}

//#endregion
export { getRelationInfo };