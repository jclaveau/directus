import { useLogger } from "../../../logger/index.js";
import database_default from "../../../database/index.js";
import { generateHash } from "../../../utils/generate-hash.js";
import { getSchema } from "../../../utils/get-schema.js";
import { UsersService } from "../../../services/users.js";

//#region src/cli/commands/users/passwd.ts
async function usersPasswd({ email, password }) {
	const database = database_default();
	const logger = useLogger();
	if (!email || !password) {
		logger.error("Email and password are required");
		process.exit(1);
	}
	try {
		const passwordHashed = await generateHash(password);
		const service = new UsersService({
			schema: await getSchema(),
			knex: database
		});
		const user = await service.knex.select("id").from("directus_users").whereRaw("LOWER(??) = ?", ["email", email.toLowerCase()]).first();
		if (user) {
			await service.knex("directus_users").update({ password: passwordHashed }).where({ id: user.id });
			logger.info(`Password is updated for user ${user.id}`);
		} else logger.error("No such user by this email");
		await database.destroy();
		process.exit(user ? 0 : 1);
	} catch (err) {
		logger.error(err);
		process.exit(1);
	}
}

//#endregion
export { usersPasswd as default };