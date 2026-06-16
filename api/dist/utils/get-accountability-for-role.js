import { fetchRolesTree } from "../permissions/lib/fetch-roles-tree.js";
import { fetchGlobalAccess } from "../permissions/modules/fetch-global-access/fetch-global-access.js";
import { createDefaultAccountability } from "../permissions/utils/create-default-accountability.js";

//#region src/utils/get-accountability-for-role.ts
async function getAccountabilityForRole(role, context) {
	let generatedAccountability;
	if (role === null) generatedAccountability = createDefaultAccountability();
	else if (role === "system") generatedAccountability = createDefaultAccountability({
		admin: true,
		app: true
	});
	else {
		const roles = await fetchRolesTree(role, { knex: context.database });
		if (roles.length === 0) throw new Error(`Configured role "${role}" isn't a valid role ID or doesn't exist.`);
		generatedAccountability = createDefaultAccountability({
			role,
			roles,
			user: null,
			...await fetchGlobalAccess({
				user: null,
				roles,
				ip: context.accountability?.ip ?? null
			}, { knex: context.database })
		});
	}
	return generatedAccountability;
}

//#endregion
export { getAccountabilityForRole };