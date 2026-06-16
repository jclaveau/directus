import { useLogger } from "../logger/index.js";
import { AccessService } from "../services/access.js";
import { UsersService } from "../services/users.js";
import { RolesService } from "../services/roles.js";
import { PoliciesService } from "../services/policies.js";
import "../services/index.js";
import { useEnv } from "@directus/env";

//#region src/utils/create-admin.ts
const defaultAdminRole = {
	name: "Administrator",
	icon: "verified",
	description: "$t:admin_description"
};
const defaultAdminUser = {
	status: "active",
	first_name: "Admin",
	last_name: "User"
};
const defaultAdminPolicy = {
	name: "Administrator",
	icon: "verified",
	admin_access: true,
	app_access: true,
	description: "$t:admin_description"
};
async function createAdmin(schema, admin) {
	const logger = useLogger();
	const env = useEnv();
	const adminEmail = admin?.email ?? env["ADMIN_EMAIL"];
	const adminPassword = admin?.password ?? env["ADMIN_PASSWORD"];
	if (!adminEmail || !adminPassword) return;
	logger.info("Setting up first admin role...");
	const accessService = new AccessService({ schema });
	const policiesService = new PoliciesService({ schema });
	const role = await new RolesService({ schema }).createOne(defaultAdminRole);
	const policy = await policiesService.createOne(defaultAdminPolicy);
	await accessService.createOne({
		policy,
		role
	});
	const usersService = new UsersService({ schema });
	const token = env["ADMIN_TOKEN"] ?? null;
	logger.info("Adding first admin user...");
	await usersService.createOne({
		...defaultAdminUser,
		first_name: admin?.first_name ?? defaultAdminUser.first_name,
		last_name: admin?.last_name ?? defaultAdminUser.last_name,
		email: adminEmail,
		password: adminPassword,
		token,
		role
	});
}

//#endregion
export { createAdmin, defaultAdminPolicy, defaultAdminRole, defaultAdminUser };