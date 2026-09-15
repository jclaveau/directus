//#region src/utils/fetch-user-count/get-user-count-query.ts
function getUserCountQuery(knex, options) {
	if (options.includeRoles && options.includeRoles.length === 0) return Promise.resolve({ count: 0 });
	let query = knex("directus_users").count({ count: "*" }).as("count").where("status", "=", "active");
	if (options.excludeIds && options.excludeIds.length > 0) query = query.whereNotIn("id", options.excludeIds);
	if (options.excludeRoles && options.excludeRoles.length > 0) query = query.whereNotIn("role", options.excludeRoles);
	if (options.includeRoles && options.includeRoles.length > 0) query = query.whereIn("role", options.includeRoles);
	return query.first();
}

//#endregion
export { getUserCountQuery };