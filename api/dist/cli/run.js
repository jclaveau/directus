import { createCli } from "./index.js";

//#region src/cli/run.ts
createCli().then((program) => program.parseAsync(process.argv)).catch((err) => {
	console.error(err);
	process.exit(1);
});

//#endregion
export {  };