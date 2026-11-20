import { withCache } from "../../../utils/with-cache.js";
import { fetchGlobalAccessForQuery } from "../utils/fetch-global-access-for-query.js";

//#region src/permissions/modules/fetch-global-access/lib/fetch-global-access-for-user.ts
const fetchGlobalAccessForUser = withCache("global-access-user", _fetchGlobalAccessForUser, ({ user, ip }) => ({
	user,
	ip
}));
async function _fetchGlobalAccessForUser(accountability, knex) {
	return await fetchGlobalAccessForQuery(knex.where("user", "=", accountability.user), accountability);
}

//#endregion
export { _fetchGlobalAccessForUser, fetchGlobalAccessForUser };