import { randomUUID } from "node:crypto";

//#region src/cli/commands/security/key.ts
async function generateKey() {
	process.stdout.write(randomUUID());
	process.exit(0);
}

//#endregion
export { generateKey as default };