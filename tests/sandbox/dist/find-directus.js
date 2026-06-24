import { dirname, join } from "path";
import { existsSync, readFileSync } from "fs";

//#region src/find-directus.ts
const directusFolder = findDirectus();
function findDirectus() {
	let currentDir = process.cwd();
	while (true) {
		const packagePath = join(currentDir, "package.json");
		if (existsSync(packagePath)) {
			const file = readFileSync(packagePath, "utf-8");
			if (JSON.parse(file)["name"] === "directus-monorepo") return currentDir;
		}
		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) break;
		currentDir = parentDir;
	}
	throw new Error("Sandbox is not executed in the directus monorepo");
}

//#endregion
export { directusFolder };