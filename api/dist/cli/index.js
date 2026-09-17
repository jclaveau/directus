import { version } from "directus/version";
import { Command, Option } from "commander";

//#region src/cli/index.ts
/**
* The first argument selecting each command this file declares.
*
* Read by the gate below rather than taken off the built program: the gate runs
* before the program exists, which is the whole of what it is for.
*/
const BUILT_IN_COMMANDS = new Set([
	"autoscale",
	"bootstrap",
	"cache",
	"count",
	"database",
	"init",
	"roles",
	"schema",
	"security",
	"start",
	"users"
]);
/**
* Whether the program has to be built with whatever the extensions register.
*
* Loading them costs a database round trip and every api-side extension the
* deployment ships, in a process that may go on to be an autoscale loop reading
* the supervisor once a second. Only a command nothing here declares can have
* come from an extension's `cli.before` hook — and `start` registers them for
* itself from `app.ts`, against the schema it has by then.
*
* The first argument that is not a flag, so a flag in front of the command does
* not stand in for it. A flag's own value there does, and what that costs is the
* load this skips — the side the gate is safe to be wrong on.
*/
function needsExtensions(argv) {
	const named = argv.find((argument) => argument.startsWith("-") === false);
	return named === void 0 || BUILT_IN_COMMANDS.has(named) === false;
}
/**
* Builds the program, reaching for a command's module only once it is run.
*
* Every process of a deployment goes through here — the workers, the
* autoscaler, each one-shot CLI call a deploy makes — and what a command
* imports is the API graph behind it: express, knex, every controller and
* service for `start` alone. Taken eagerly that is ~160 MB resident and ~3s of
* module loading spent before commander has read which command was asked for,
* in processes that go on to run one of them (jclaveau/directus#489).
*
* The extension loader and the emitter are reached the same way, behind the
* gate: the loader's module is the extension manager's graph (express, knex,
* rollup, every service), and the emitter's is the database's. Only an
* extension listens on `cli.before` and `cli.after`, so a process that loads
* none has nothing to emit to.
*/
async function createCli(argv = process.argv.slice(2)) {
	const program = new Command();
	let emitter = null;
	if (needsExtensions(argv)) {
		const [{ loadExtensions }, { useEmitter }] = await Promise.all([import("./load-extensions.js"), import("../emitter.js")]);
		await loadExtensions();
		emitter = useEmitter();
		await emitter.emitInit("cli.before", { program });
	}
	program.name("directus").usage("[command] [options]");
	program.version(version, "-v, --version");
	program.command("start").description("Start the Directus API").allowExcessArguments().action(async () => {
		const { startServer } = await import("../server.js");
		await startServer();
	});
	program.command("init").description("Create a new Directus Project").action(async () => {
		const { default: init } = await import("./commands/init/index.js");
		await init();
	});
	program.command("autoscale").description("Resize the API worker pool to match its load").action(async () => {
		const { runAutoscaler } = await import("../processes/autoscale/index.js");
		await runAutoscaler();
	});
	const securityCommand = program.command("security");
	securityCommand.command("key:generate").description("Generate the app key").action(async () => {
		const { default: keyGenerate } = await import("./commands/security/key.js");
		await keyGenerate();
	});
	securityCommand.command("secret:generate").description("Generate the app secret").action(async () => {
		const { default: secretGenerate } = await import("./commands/security/secret.js");
		await secretGenerate();
	});
	const dbCommand = program.command("database");
	dbCommand.command("install").description("Install the database").action(async () => {
		const { default: dbInstall } = await import("./commands/database/install.js");
		await dbInstall();
	});
	/** One module for the three directions, reached once whichever was asked for. */
	const migrate = async (direction) => {
		const { default: dbMigrate } = await import("./commands/database/migrate.js");
		await dbMigrate(direction);
	};
	dbCommand.command("migrate:latest").description("Upgrade the database").action(() => migrate("latest"));
	dbCommand.command("migrate:up").description("Upgrade the database").action(() => migrate("up"));
	dbCommand.command("migrate:down").description("Downgrade the database").action(() => migrate("down"));
	const cacheCommand = program.command("cache");
	cacheCommand.command("flush").description("Flush the response, system and permission caches on every node").action(async () => {
		const { default: cacheFlush } = await import("./commands/cache/flush.js");
		await cacheFlush();
	});
	cacheCommand.command("audit").description("Replay every live cache entry against the database and report the stale ones").option("--json", "print the report as JSON").option("--purge", "evict the stale and tag-drifted entries once reported").option("--strict", "exit 2 when an entry could not be replayed").option("--limit <count>", "stop after this many entries; the next run resumes behind them [CACHE_AUDIT_LIMIT]").option("--user <id>", "only the entries filled for this user").option("--collection <name>", "only the entries reading this collection").action(async (options) => {
		const { default: cacheAudit } = await import("./commands/cache/audit.js");
		await cacheAudit(options);
	});
	const usersCommand = program.command("users");
	usersCommand.command("create").description("Create a new user").option("--email <value>", `user's email`).option("--password <value>", `user's password`).option("--role <value>", `user's role`).action(async (options) => {
		const { default: usersCreate } = await import("./commands/users/create.js");
		await usersCreate(options);
	});
	usersCommand.command("passwd").description("Set user password").option("--email <value>", `user's email`).option("--password <value>", `user's new password`).action(async (options) => {
		const { default: usersPasswd } = await import("./commands/users/passwd.js");
		await usersPasswd(options);
	});
	program.command("roles").command("create").description("Create a new role").option("--role <value>", `name for the role`).option("--admin", `whether or not the role has admin access`).option("--app", `whether or not the role has app access`).action(async (options) => {
		const { default: rolesCreate } = await import("./commands/roles/create.js");
		await rolesCreate(options);
	});
	program.command("count <collection>").description("Count the amount of items in a given collection").action(async (collection) => {
		const { default: count } = await import("./commands/count/index.js");
		await count(collection);
	});
	program.command("bootstrap").description("Initialize or update the database").option("--skipAdminInit", "Skips the creation of the default Admin Role and User").action(async (options) => {
		const { default: bootstrap } = await import("./commands/bootstrap/index.js");
		await bootstrap(options);
	});
	const schemaCommands = program.command("schema");
	schemaCommands.command("snapshot").description("Create a new Schema Snapshot").option("-y, --yes", `Assume "yes" as answer to all prompts and run non-interactively`, false).addOption(new Option("--format <format>", "JSON or YAML format").choices(["json", "yaml"]).default("yaml")).argument("[path]", "Path to snapshot file").action(async (path, options) => {
		const { snapshot } = await import("./commands/schema/snapshot.js");
		await snapshot(path, options);
	});
	schemaCommands.command("apply").description("Apply a snapshot file to the current database").option("-y, --yes", `Assume "yes" as answer to all prompts and run non-interactively`).option("-d, --dry-run", "Plan and log changes to be applied", false).option("--ignoreRules <value>", `Comma-separated list of collections and or fields to ignore. Format: "products.title,reviews" this will ignore applying changes to the title field in the products collection and the entire reviews collection`).argument("<path>", "Path to snapshot file").action(async (path, options) => {
		const { apply } = await import("./commands/schema/apply.js");
		await apply(path, options);
	});
	await emitter?.emitInit("cli.after", { program });
	return program;
}

//#endregion
export { BUILT_IN_COMMANDS, createCli };