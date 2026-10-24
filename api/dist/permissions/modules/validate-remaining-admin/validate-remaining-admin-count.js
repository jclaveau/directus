import { UnprocessableContentError } from "@directus/errors";

//#region src/permissions/modules/validate-remaining-admin/validate-remaining-admin-count.ts
function validateRemainingAdminCount(count) {
	if (count <= 0) throw new UnprocessableContentError({ reason: `Cannot remove the last admin user from the system` });
}

//#endregion
export { validateRemainingAdminCount };