import { useLogger } from "../../../logger/index.js";
import database_default from "../../../database/index.js";
import { getSchema } from "../../../utils/get-schema.js";
import { UsersService } from "../../../services/users.js";

//#region src/cli/commands/users/create.ts
async function usersCreate({ email, password, role }) {
	const database = database_default();
	const logger = useLogger();
	if (!email || !password || !role) {
		logger.error("Email, password, role are required");
		process.exit(1);
	}
	try {
		const id = await new UsersService({
			schema: await getSchema(),
			knex: database
		}).createOne({
			email,
			password,
			role,
			status: "active"
		});
		process.stdout.write(`${String(id)}\n`);
		database.destroy();
		process.exit(0);
	} catch (err) {
		logger.error(err);
		process.exit(1);
	}
}

//#endregion
export { usersCreate as default };