import { fetchAccessLookup } from "./fetch-access-lookup.js";
import { fetchAccessRoles } from "./fetch-access-roles.js";
import { getUserCountQuery } from "./get-user-count-query.js";
import { toBoolean } from "@directus/utils";

//#region src/utils/fetch-user-count/fetch-user-count.ts
/**
* Returns counts of all active users in the system grouped by admin, app, and api access
*/
async function fetchUserCount(options) {
	const accessRows = await fetchAccessLookup(options);
	const adminRoles = new Set(accessRows.filter((row) => toBoolean(row.admin_access) && row.role !== null).map((row) => row.role));
	const appRoles = new Set(accessRows.filter((row) => !toBoolean(row.admin_access) && toBoolean(row.app_access) && row.role !== null).map((row) => row.role));
	const adminUsers = new Set(accessRows.filter((row) => toBoolean(row.admin_access) && row.user !== null && row.user_status === "active").map((row) => row.user));
	const { adminRoles: allAdminRoles, appRoles: allAppRoles } = await fetchAccessRoles({
		adminRoles,
		appRoles,
		...options
	}, { knex: options.knex });
	const adminCountQuery = getUserCountQuery(options.knex, {
		includeRoles: Array.from(allAdminRoles),
		excludeIds: [...adminUsers, ...options.excludeUsers ?? []]
	});
	if (options.adminOnly) {
		const adminResult$1 = await adminCountQuery;
		return {
			admin: Number(adminResult$1?.["count"] ?? 0) + adminUsers.size,
			app: 0,
			api: 0
		};
	}
	const appUsers = new Set(accessRows.filter((row) => !toBoolean(row.admin_access) && toBoolean(row.app_access) && row.user !== null && row.user_status === "active" && adminUsers.has(row.user) === false && adminRoles.has(row.user_role) === false).map((row) => row.user));
	const appCountQuery = getUserCountQuery(options.knex, {
		includeRoles: Array.from(allAppRoles),
		excludeRoles: Array.from(allAdminRoles),
		excludeIds: [
			...appUsers,
			...adminUsers,
			...options.excludeUsers ?? []
		]
	});
	const allCountQuery = getUserCountQuery(options.knex, { excludeIds: options.excludeUsers ?? [] });
	const [adminResult, appResult, allResult] = await Promise.all([
		adminCountQuery,
		appCountQuery,
		allCountQuery
	]);
	const adminCount = Number(adminResult?.["count"] ?? 0) + adminUsers.size;
	const appCount = Number(appResult?.["count"] ?? 0) + appUsers.size;
	return {
		admin: adminCount,
		app: appCount,
		api: Math.max(0, Number(allResult?.["count"] ?? 0) - adminCount - appCount)
	};
}

//#endregion
export { fetchUserCount };