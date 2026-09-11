//#region src/utils/fetch-user-count/fetch-active-users.ts
async function fetchActiveUsers(knex) {
	return await knex.select("id", "role").from("directus_users").where("status", "active");
}

//#endregion
export { fetchActiveUsers };