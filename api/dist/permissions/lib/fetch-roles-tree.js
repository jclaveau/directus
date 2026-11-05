import { withCache } from "../utils/with-cache.js";

//#region src/permissions/lib/fetch-roles-tree.ts
const fetchRolesTree = withCache("roles-tree", _fetchRolesTree);
async function _fetchRolesTree(start, knex) {
	if (!start) return [];
	let parent = start;
	const roles = [];
	while (parent) {
		const role = await knex.select("id", "parent").from("directus_roles").where({ id: parent }).first();
		if (!role) break;
		roles.push(role.id);
		if (role.parent && roles.includes(role.parent) === true) {
			roles.reverse();
			const rolesStr = roles.map((role$1) => `"${role$1}"`).join("->");
			throw new Error(`Recursion encountered: role "${role.id}" already exists in tree path ${rolesStr}`);
		}
		parent = role.parent;
	}
	roles.reverse();
	return roles;
}

//#endregion
export { _fetchRolesTree, fetchRolesTree };