//#region src/cli/commands/security/secret.ts
async function generateSecret() {
	const { nanoid } = await import("nanoid");
	process.stdout.write(nanoid(32));
	process.exit(0);
}

//#endregion
export { generateSecret as default };