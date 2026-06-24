import database_default from "../../../database/index.js";
import { fetchAccessRoles } from "../../../utils/fetch-user-count/fetch-access-roles.js";
import { AccessService } from "../../../services/access.js";
import { getSchema } from "../../../utils/get-schema.js";
import { UsersService } from "../../../services/users.js";
import "../../../services/index.js";
import { toBoolean } from "@directus/utils";
import { USER_INACTIVE_LICENSE_STATUS } from "@directus/constants";

//#region src/license/entitlements/lib/seats.ts
/**
* Group access rows to the admin/app users and roles that occupy a seat.
*/
function getSeatUsersAndRoles(accessRows) {
	const adminRoles = /* @__PURE__ */ new Set();
	const appRoles = /* @__PURE__ */ new Set();
	const adminUsers = /* @__PURE__ */ new Set();
	const appUsers = /* @__PURE__ */ new Set();
	const appUsersByRole = /* @__PURE__ */ new Map();
	for (const accessRow of accessRows) {
		const { admin_access, app_access } = accessRow["policy"] || {};
		const isAdmin = toBoolean(admin_access);
		const isApp = !isAdmin && toBoolean(app_access);
		if (!isAdmin && !isApp) continue;
		if (accessRow["user"] && accessRow["user"].status === "active") {
			const { id, role } = accessRow["user"];
			if (isAdmin) {
				adminUsers.add(id);
				appUsers.delete(id);
			} else if (adminUsers.has(id) === false && (!role || adminRoles.has(role) === false)) {
				appUsers.add(id);
				if (role) {
					const roleUsers = appUsersByRole.get(role) ?? /* @__PURE__ */ new Set();
					appUsersByRole.set(role, roleUsers.add(id));
				}
			}
		}
		if (accessRow["role"]) if (isAdmin) {
			adminRoles.add(accessRow["role"]);
			for (const id of appUsersByRole.get(accessRow["role"]) ?? []) appUsers.delete(id);
		} else appRoles.add(accessRow["role"]);
	}
	return {
		adminUsers,
		appUsers,
		adminRoles,
		appRoles
	};
}
async function getActiveSeats(opts) {
	const knex = opts?.knex ?? database_default();
	const schema = await getSchema({ database: knex });
	const { adminUsers, appUsers, adminRoles, appRoles } = getSeatUsersAndRoles(await new AccessService({
		schema,
		knex
	}).readByQuery({
		fields: [
			"role",
			"user.id",
			"user.status",
			"user.role",
			"policy.app_access",
			"policy.admin_access"
		],
		limit: -1
	}));
	const { adminRoles: allAdminRoles, appRoles: allAppRoles } = await fetchAccessRoles({
		adminRoles,
		appRoles
	}, { knex });
	const usersService = new UsersService({
		schema,
		knex
	});
	const adminFilters = [{ _or: [{ id: { _in: Array.from(adminUsers) } }, { role: { _in: Array.from(allAdminRoles) } }] }, { status: { _eq: "active" } }];
	const appFilters = [{ _or: [{ id: {
		_in: Array.from(appUsers),
		_nin: Array.from(adminUsers)
	} }, { role: {
		_in: Array.from(allAppRoles),
		_nin: Array.from(allAdminRoles)
	} }] }, { status: { _eq: "active" } }];
	if (opts?.adminId) {
		adminFilters.push({ id: { _neq: opts.adminId } });
		appFilters.push({ id: { _neq: opts.adminId } });
	}
	const adminCandidates = await usersService.readByQuery({
		fields: [
			"id",
			"first_name",
			"last_name",
			"avatar",
			"email"
		],
		filter: { _and: adminFilters },
		limit: -1
	});
	return [...await usersService.readByQuery({
		fields: [
			"id",
			"first_name",
			"last_name",
			"avatar",
			"email"
		],
		filter: { _and: appFilters },
		limit: -1
	}), ...adminCandidates.map((admin) => ({
		...admin,
		admin: true
	}))];
}
async function countActiveSeats(opts) {
	return (await getActiveSeats(opts)).length;
}
async function resolveSeats(seats, ctx) {
	if (!ctx?.accountability?.user) return;
	const usersService = new UsersService({
		schema: await getSchema(),
		accountability: ctx.accountability
	});
	const users = seats.filter((user_id) => user_id !== ctx.accountability.user);
	await Promise.allSettled(users.map((user_id) => usersService.updateOne(user_id, { status: USER_INACTIVE_LICENSE_STATUS })));
}

//#endregion
export { countActiveSeats, getActiveSeats, getSeatUsersAndRoles, resolveSeats };