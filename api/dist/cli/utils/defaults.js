//#region src/cli/utils/defaults.ts
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

//#endregion
export { defaultAdminPolicy, defaultAdminRole, defaultAdminUser };