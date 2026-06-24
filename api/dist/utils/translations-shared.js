import { InvalidPayloadError } from "@directus/errors";
import { GENERATE_SPECIAL, RELATIONAL_TYPES, TRANSLATIONS_STRIPPED_ON_CLONE_SPECIALS } from "@directus/constants";

//#region src/utils/translations-shared.ts
const DANGEROUS_SPECIALS = new Set(GENERATE_SPECIAL);
const RELATIONAL_SPECIALS = new Set(RELATIONAL_TYPES);
const STRIPPED_ON_CLONE_SPECIALS = new Set(TRANSLATIONS_STRIPPED_ON_CLONE_SPECIALS);
function validateFieldsEligibility(sourceFields) {
	for (const sourceField of sourceFields) {
		const specials = Array.isArray(sourceField.meta?.special) ? sourceField.meta.special : [];
		if (sourceField.type === "alias" || sourceField.meta?.system === true || sourceField.schema?.has_auto_increment === true) throw new InvalidPayloadError({ reason: `Field "${sourceField.field}" is not eligible for translations` });
		if (specials.some((special) => DANGEROUS_SPECIALS.has(special) || RELATIONAL_SPECIALS.has(special))) throw new InvalidPayloadError({ reason: `Field "${sourceField.field}" is not eligible for translations` });
	}
}
function cloneFields(options) {
	const { fields: fieldNames, sourceFields } = options;
	return fieldNames.map((fieldName) => {
		const sourceField = sourceFields.find((field) => field.field === fieldName);
		if (!sourceField) throw new InvalidPayloadError({ reason: `Field "${fieldName}" does not exist in source fields` });
		const clonedMeta = { ...sourceField.meta ?? {} };
		delete clonedMeta.id;
		delete clonedMeta.collection;
		delete clonedMeta.sort;
		delete clonedMeta.group;
		clonedMeta.required = false;
		clonedMeta.hidden = false;
		clonedMeta.readonly = false;
		if (Array.isArray(clonedMeta.special)) {
			clonedMeta.special = clonedMeta.special.filter((special) => !STRIPPED_ON_CLONE_SPECIALS.has(special));
			if (clonedMeta.special.length === 0) clonedMeta.special = null;
		}
		return {
			field: fieldName,
			type: sourceField.type ?? "string",
			schema: {
				default_value: sourceField.schema?.default_value ?? null,
				max_length: sourceField.schema?.max_length ?? null,
				numeric_precision: sourceField.schema?.numeric_precision ?? null,
				numeric_scale: sourceField.schema?.numeric_scale ?? null,
				is_nullable: true
			},
			meta: clonedMeta
		};
	});
}

//#endregion
export { DANGEROUS_SPECIALS, RELATIONAL_SPECIALS, STRIPPED_ON_CLONE_SPECIALS, cloneFields, validateFieldsEligibility };