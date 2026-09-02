import { withAppMinimalPermissions } from "../lib/with-app-minimal-permissions.js";
import { withCache } from "./with-cache.js";
import { sortBy } from "lodash-es";

//#region src/permissions/utils/fetch-raw-permissions.ts
const fetchRawPermissions = withCache("raw-permissions", _fetchRawPermissions, ({ action, policies, collections, accountability, bypassMinimalAppPermissions }) => ({
	policies,
	...action && { action },
	...collections && { collections: sortBy(collections) },
	...accountability && { accountability: { app: accountability.app } },
	...bypassMinimalAppPermissions && { bypassMinimalAppPermissions }
}));
async function _fetchRawPermissions(options, context) {
	const { PermissionsService } = await import("../../services/permissions.js");
	const permissionsService = new PermissionsService(context);
	const filter = { _and: [{ policy: { _in: options.policies } }] };
	if (options.action) filter._and.push({ action: { _eq: options.action } });
	if (options.collections) filter._and.push({ collection: { _in: options.collections } });
	let permissions = await permissionsService.readByQuery({
		filter,
		limit: -1
	});
	permissions = sortBy(permissions, (permission) => options.policies.indexOf(permission.policy));
	if (options.accountability && !options.bypassMinimalAppPermissions) return withAppMinimalPermissions(options.accountability ?? null, permissions, { _and: filter._and.slice(1) });
	return permissions;
}

//#endregion
export { _fetchRawPermissions, fetchRawPermissions };