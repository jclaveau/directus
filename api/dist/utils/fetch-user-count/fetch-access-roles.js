//#region src/utils/fetch-user-count/fetch-access-roles.ts
/**
* Return a set of roles that allow app or admin access, if itself or any of its parents do
*/
async function fetchAccessRoles(options, context) {
	const allChildRoles = await context.knex.select("id", "parent").from("directus_roles").whereNotNull("parent").whereNotIn("id", options.excludeRoles ?? []);
	const adminRoles = new Set(options.adminRoles);
	const appRoles = new Set(options.appRoles);
	const remainingRoles = new Set(allChildRoles);
	let hasChanged = remainingRoles.size > 0;
	while (hasChanged) {
		hasChanged = false;
		for (const role of remainingRoles) {
			if (adminRoles.has(role.parent)) {
				adminRoles.add(role.id);
				remainingRoles.delete(role);
				hasChanged = true;
			}
			if (appRoles.has(role.parent)) {
				appRoles.add(role.id);
				remainingRoles.delete(role);
				hasChanged = true;
			}
		}
	}
	return {
		adminRoles,
		appRoles
	};
}

//#endregion
export { fetchAccessRoles };