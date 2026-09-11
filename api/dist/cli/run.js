import { getMilliseconds } from "../utils/get-milliseconds.js";
import { createCli } from "./index.js";
import { armDeadline } from "./utils/arm-deadline.js";
import { useEnv } from "@directus/env";

//#region src/cli/run.ts
const [command, subcommand] = process.argv.slice(2).filter((argument) => argument.startsWith("-") === false);
if (command === "cache" && subcommand === "flush") armDeadline(getMilliseconds(useEnv()["CACHE_FLUSH_TIMEOUT"]), "the cache flush");
createCli().then((program) => program.parseAsync(process.argv)).catch((err) => {
	console.error(err);
	process.exit(1);
});

//#endregion
export {  };