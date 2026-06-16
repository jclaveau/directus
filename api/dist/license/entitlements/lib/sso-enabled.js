import { DEFAULT_AUTH_PROVIDER } from "../../../constants.js";
import database_default from "../../../database/index.js";
import { getSchema } from "../../../utils/get-schema.js";
import { UsersService } from "../../../services/users.js";
import "../../../services/index.js";
import { isObject } from "@directus/utils";
import { USER_INACTIVE_LICENSE_STATUS } from "@directus/constants";

//#region src/license/entitlements/lib/sso-enabled.ts
/**
* Counting the current amount of users with sso enabled
*/
async function checkUsersSSO(opts) {
	const knex = opts?.knex ?? database_default();
	return (await new UsersService({
		schema: await getSchema({ database: knex }),
		knex
	}).readByQuery({
		fields: ["id"],
		filter: {
			provider: { _neq: DEFAULT_AUTH_PROVIDER },
			status: { _eq: "active" }
		}
	})).length === 0;
}
async function resolveSSOUsers(resolution, ctx) {
	if (!ctx?.accountability?.user) return;
	const adminId = ctx.accountability.user;
	const usersService = new UsersService({
		schema: await getSchema(),
		accountability: ctx?.accountability
	});
	await usersService.updateByQuery({ filter: { _and: [{ provider: {
		_neq: DEFAULT_AUTH_PROVIDER,
		_nnull: true
	} }, { id: { _neq: adminId } }] } }, { status: USER_INACTIVE_LICENSE_STATUS });
	if (isObject(resolution) && Object.keys(resolution.admin ?? {}).length) {
		const payload = { provider: DEFAULT_AUTH_PROVIDER };
		if (resolution.admin.email?.length) payload["email"] = resolution.admin.email;
		if (resolution.admin.password?.length) payload["password"] = resolution.admin.password;
		await usersService.updateOne(adminId, payload);
	}
}

//#endregion
export { checkUsersSSO, resolveSSOUsers };