import { useLogger } from "../../../logger/index.js";
import database_default from "../../../database/index.js";
import { AccessService } from "../../../services/access.js";
import { getSchema } from "../../../utils/get-schema.js";
import { RolesService } from "../../../services/roles.js";
import { PoliciesService } from "../../../services/policies.js";
import "../../../services/index.js";

//#region src/cli/commands/roles/create.ts
async function rolesCreate({ role: name, admin, app }) {
	const database = database_default();
	const logger = useLogger();
	if (!name) {
		logger.error("Name is required");
		process.exit(1);
	}
	try {
		const schema = await getSchema();
		const rolesService = new RolesService({
			schema,
			knex: database
		});
		const policiesService = new PoliciesService({
			schema,
			knex: database
		});
		const accessService = new AccessService({
			schema,
			knex: database
		});
		const adminPolicyId = await policiesService.createOne({
			name: `Policy for ${name}`,
			admin_access: admin,
			app_access: app,
			icon: "supervised_user_circle"
		});
		const roleId = await rolesService.createOne({ name });
		await accessService.createOne({
			role: roleId,
			policy: adminPolicyId
		});
		process.stdout.write(`${String(roleId)}\n`);
		database.destroy();
		process.exit(0);
	} catch (err) {
		logger.error(err);
		process.exit(1);
	}
}

//#endregion
export { rolesCreate as default };