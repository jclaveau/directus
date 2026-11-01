import { validateRemainingAdminCount } from "./validate-remaining-admin-count.js";
import { fetchUserCount } from "../../../utils/fetch-user-count/fetch-user-count.js";

//#region src/permissions/modules/validate-remaining-admin/validate-remaining-admin-users.ts
async function validateRemainingAdminUsers(options, context) {
	const { admin } = await fetchUserCount({
		...options,
		adminOnly: true,
		knex: context.knex
	});
	validateRemainingAdminCount(admin);
}

//#endregion
export { validateRemainingAdminUsers };