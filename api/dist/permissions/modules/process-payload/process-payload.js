import { extractRequiredDynamicVariableContext } from "../../utils/extract-required-dynamic-variable-context.js";
import { fetchDynamicVariableData } from "../../utils/fetch-dynamic-variable-data.js";
import { fetchPolicies } from "../../lib/fetch-policies.js";
import { fetchPermissions } from "../../lib/fetch-permissions.js";
import { createCollectionForbiddenError, createFieldsForbiddenError } from "../process-ast/utils/validate-path/create-error.js";
import { contextHasDynamicVariables } from "../process-ast/utils/context-has-dynamic-variables.js";
import { isFieldNullable } from "./lib/is-field-nullable.js";
import { parseFilter, validatePayload } from "@directus/utils";
import { assign, difference, uniq } from "lodash-es";
import { FailedValidationError, joiValidationErrorItemToErrorExtensions } from "@directus/validation";

//#region src/permissions/modules/process-payload/process-payload.ts
/**
* @note this only validates the top-level fields. The expectation is that this function is called
* for each level of nested insert separately
*/
async function processPayload(options, context) {
	let permissions;
	let permissionValidationRules = [];
	let policies = [];
	if (!options.accountability.admin) {
		policies = await fetchPolicies(options.accountability, context);
		permissions = await fetchPermissions({
			action: options.action,
			policies,
			collections: [options.collection],
			accountability: options.accountability
		}, context);
		if (permissions.length === 0) throw createCollectionForbiddenError("", options.collection);
		const fieldsAllowed = uniq(permissions.map(({ fields: fields$1 }) => fields$1 ?? []).flat());
		if (fieldsAllowed.includes("*") === false) {
			const notAllowed = difference(Object.keys(options.payload), fieldsAllowed);
			if (notAllowed.length > 0) throw createFieldsForbiddenError("", options.collection, notAllowed);
		}
		permissionValidationRules = permissions.map(({ validation }) => validation);
	}
	const fields = Object.values(context.schema.collections[options.collection]?.fields ?? {});
	const fieldValidationRules = [];
	for (const field of fields) {
		if (!isFieldNullable(field)) {
			if (options.action === "create" && field.defaultValue === null) fieldValidationRules.push({ [field.field]: { _submitted: true } });
			fieldValidationRules.push({ [field.field]: { _nnull: true } });
		}
		if (field.validation) {
			const permissionContext = extractRequiredDynamicVariableContext(field.validation);
			const filterContext = contextHasDynamicVariables(permissionContext) ? await fetchDynamicVariableData({
				accountability: options.accountability,
				policies,
				dynamicVariableContext: permissionContext
			}, context) : void 0;
			const validationFilter = parseFilter(field.validation, options.accountability, filterContext);
			fieldValidationRules.push(validationFilter);
		}
	}
	const payloadWithPresets = assign({}, ...(permissions ?? []).map((permission) => permission.presets), options.payload);
	const validationRules = [...fieldValidationRules, ...permissionValidationRules].filter((rule) => {
		if (rule === null) return false;
		if (Object.keys(rule).length === 0) return false;
		return true;
	});
	if (validationRules.length > 0) {
		const validationErrors = [];
		validationErrors.push(...validatePayload({ _and: validationRules }, payloadWithPresets).map((error) => error.details.map((details) => new FailedValidationError(joiValidationErrorItemToErrorExtensions(details, options.nested)))).flat());
		if (validationErrors.length > 0) throw validationErrors;
	}
	return payloadWithPresets;
}

//#endregion
export { processPayload };