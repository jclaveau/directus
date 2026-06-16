import { createCollectionForbiddenError } from "../process-ast/utils/validate-path/create-error.js";
import { validateItemAccess } from "./lib/validate-item-access.js";
import { validateCollectionAccess } from "./lib/validate-collection-access.js";
import { ForbiddenError } from "@directus/errors";

//#region src/permissions/modules/validate-access/validate-access.ts
/**
* Validate if the current user has access to perform action against the given collection and
* optional primary keys. This is done by reading the item from the database using the access
* control rules and checking if we got the expected result back
*/
async function validateAccess(options, context) {
	if (!options.skipCollectionExistsCheck && options.collection in context.schema.collections === false) throw createCollectionForbiddenError("", options.collection);
	if (options.accountability.admin === true) return;
	let access;
	if (options.primaryKeys) access = (await validateItemAccess(options, context)).accessAllowed;
	else access = await validateCollectionAccess(options, context);
	if (!access) {
		if (options.fields?.length ?? false) throw new ForbiddenError({ reason: `You don't have permissions to perform "${options.action}" for the field(s) ${options.fields.map((field) => `"${field}"`).join(", ")} in collection "${options.collection}" or it does not exist.` });
		throw new ForbiddenError({ reason: `You don't have permission to perform "${options.action}" for collection "${options.collection}" or it does not exist.` });
	}
}

//#endregion
export { validateAccess };