import { withCache } from "../utils/with-cache.js";
import { fetchRolesTree as fetchRolesTree$1 } from "@directus/utils/node";

//#region src/permissions/lib/fetch-roles-tree.ts
/**
* Fetches the roles tree starting from a specific role.
*/
const fetchRolesTree = withCache("roles-tree", fetchRolesTree$1, (start) => ({ start }));

//#endregion
export { fetchRolesTree };