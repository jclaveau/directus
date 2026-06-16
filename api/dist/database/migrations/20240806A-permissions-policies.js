import { useLogger } from "../../logger/index.js";
import { getSchemaInspector } from "../index.js";
import { fetchPolicies } from "../../permissions/lib/fetch-policies.js";
import { fetchRolesTree } from "../../permissions/lib/fetch-roles-tree.js";
import { mergePermissions } from "../../permissions/utils/merge-permissions.js";
import { fetchPermissions } from "../../permissions/lib/fetch-permissions.js";
import { getSchema } from "../../utils/get-schema.js";
import { processChunk, toBoolean } from "@directus/utils";
import { omit } from "lodash-es";
import { randomUUID } from "node:crypto";

//#region src/database/migrations/20240806A-permissions-policies.ts
async function fetchRoleAccess(roles, context) {
	const roleAccess = {
		admin_access: false,
		app_access: false,
		ip_access: null,
		enforce_tfa: false
	};
	const accessRows = await context.knex("directus_access").select("directus_policies.id", "directus_policies.admin_access", "directus_policies.app_access", "directus_policies.ip_access", "directus_policies.enforce_tfa").where("role", "in", roles).leftJoin("directus_policies", "directus_policies.id", "directus_access.policy");
	const ipAccess = /* @__PURE__ */ new Set();
	for (const { admin_access, app_access, ip_access, enforce_tfa } of accessRows) {
		roleAccess.admin_access ||= toBoolean(admin_access);
		roleAccess.app_access ||= toBoolean(app_access);
		roleAccess.enforce_tfa ||= toBoolean(enforce_tfa);
		if (ip_access && ip_access.length) ip_access.split(",").forEach((ip) => ipAccess.add(ip));
	}
	if (ipAccess.size > 0) roleAccess.ip_access = Array.from(ipAccess).join(",");
	return roleAccess;
}
/**
* The public role used to be `null`, we gotta create a single new policy for the permissions
* previously attached to the public role (marked through `role = null`).
*/
const PUBLIC_POLICY_ID = "abf8a154-5b1c-4a46-ac9c-7300570f4f17";
async function up(knex) {
	const logger = useLogger();
	if (await knex.schema.hasTable("directus_policies")) return;
	await knex.schema.createTable("directus_policies", (table) => {
		table.uuid("id").primary();
		table.string("name", 100).notNullable();
		table.string("icon", 64).notNullable().defaultTo("badge");
		table.text("description");
		table.text("ip_access");
		table.boolean("enforce_tfa").defaultTo(false).notNullable();
		table.boolean("admin_access").defaultTo(false).notNullable();
		table.boolean("app_access").defaultTo(false).notNullable();
	});
	const roles = await knex.select("id", "name", "icon", "description", "ip_access", "enforce_tfa", "admin_access", "app_access").from("directus_roles");
	if (roles.length > 0) await processChunk(roles, 100, async (chunk$1) => {
		await knex("directus_policies").insert(chunk$1);
	});
	await knex.insert({
		id: PUBLIC_POLICY_ID,
		name: "$t:public_label",
		icon: "public",
		description: "$t:public_description",
		app_access: false
	}).into("directus_policies");
	await knex("directus_policies").update({ description: "$t:admin_policy_description" }).where("description", "LIKE", "$t:admin_description");
	await knex.schema.alterTable("directus_roles", (table) => {
		table.dropColumn("ip_access");
		table.dropColumn("enforce_tfa");
		table.dropColumn("admin_access");
		table.dropColumn("app_access");
		table.uuid("parent").references("directus_roles.id");
	});
	await knex.schema.alterTable("directus_permissions", (table) => {
		table.uuid("policy");
	});
	try {
		const foreignConstraint = (await (await getSchemaInspector(knex)).foreignKeys("directus_permissions")).find((foreign) => foreign.foreign_key_table === "directus_roles" && foreign.column === "role")?.constraint_name || void 0;
		await knex.schema.alterTable("directus_permissions", (table) => {
			table.dropForeign("role", foreignConstraint);
		});
	} catch {
		logger.warn("Failed to drop foreign key constraint on `role` column in `directus_permissions` table");
	}
	await knex("directus_permissions").update({ role: PUBLIC_POLICY_ID }).whereNull("role");
	await knex("directus_permissions").update({ policy: knex.ref("role") });
	await knex.schema.alterTable("directus_permissions", (table) => {
		table.dropColumns("role");
		table.dropNullable("policy");
		table.foreign("policy").references("directus_policies.id").onDelete("CASCADE");
	});
	await knex.schema.createTable("directus_access", (table) => {
		table.uuid("id").primary();
		table.uuid("role").references("directus_roles.id").nullable().onDelete("CASCADE");
		table.uuid("user").references("directus_users.id").nullable().onDelete("CASCADE");
		table.uuid("policy").references("directus_policies.id").notNullable().onDelete("CASCADE");
		table.integer("sort");
	});
	await processChunk(roles.map((role) => ({
		id: randomUUID(),
		role: role.id,
		user: null,
		policy: role.id,
		sort: 1
	})), 100, async (chunk$1) => {
		await knex("directus_access").insert(chunk$1);
	});
	await knex("directus_access").insert({
		id: randomUUID(),
		role: null,
		user: null,
		policy: PUBLIC_POLICY_ID,
		sort: 1
	});
}
async function down(knex) {
	await knex.schema.alterTable("directus_roles", (table) => {
		table.text("ip_access");
		table.boolean("enforce_tfa").defaultTo(false).notNullable();
		table.boolean("admin_access").defaultTo(false).notNullable();
		table.boolean("app_access").defaultTo(true).notNullable();
	});
	const originalPermissions = await knex.select("id").from("directus_permissions").whereNot({ policy: PUBLIC_POLICY_ID });
	await knex.schema.alterTable("directus_permissions", (table) => {
		table.uuid("role").nullable();
		table.setNullable("policy");
	});
	const context = {
		knex,
		schema: await getSchema()
	};
	const roles = await knex.select("id").from("directus_roles");
	roles.push({ id: null });
	const rolePermissions = [];
	for (const role of roles) {
		const roleTree = await fetchRolesTree(role.id, { knex });
		let roleAccess = null;
		if (role.id !== null) {
			roleAccess = await fetchRoleAccess(roleTree, context);
			await knex("directus_roles").update(roleAccess).where({ id: role.id });
		}
		if (roleAccess === null || !roleAccess.admin_access) {
			const policies = await fetchPolicies({
				roles: roleTree,
				user: null,
				ip: null
			}, context);
			mergePermissions("or", await fetchPermissions({
				accountability: {
					role: null,
					roles: roleTree,
					user: null,
					app: roleAccess?.app_access || false
				},
				policies,
				bypassDynamicVariableProcessing: true
			}, context)).forEach((permission) => {
				if (permission.system) return;
				if (Array.isArray(permission.fields)) permission.fields = permission.fields.join(",");
				if (permission.permissions) permission.permissions = JSON.stringify(permission.permissions);
				if (permission.validation) permission.validation = JSON.stringify(permission.validation);
				if (permission.presets) permission.presets = JSON.stringify(permission.presets);
				rolePermissions.push({
					role: role.id,
					...omit(permission, ["id", "policy"])
				});
			});
		}
	}
	await knex.schema.alterTable("directus_roles", (table) => {
		table.dropForeign("parent");
		table.dropColumn("parent");
	});
	await knex.schema.dropTable("directus_access");
	await knex("directus_permissions").update({ role: null }).where({ role: PUBLIC_POLICY_ID });
	await processChunk(originalPermissions, 100, async (chunk$1) => {
		await knex("directus_permissions").delete(chunk$1);
	});
	await processChunk(rolePermissions, 100, async (chunk$1) => {
		await knex("directus_permissions").insert(chunk$1);
	});
	await knex.schema.alterTable("directus_permissions", (table) => {
		table.uuid("role").references("directus_roles.id").alter();
		table.dropForeign("policy");
		table.dropColumn("policy");
	});
	await knex.schema.dropTable("directus_policies");
}

//#endregion
export { down, up };