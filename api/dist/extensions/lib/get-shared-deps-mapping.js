import { useLogger } from "../../logger/index.js";
import { Url } from "../../utils/url.js";
import { readdir } from "node:fs/promises";
import path from "path";
import { useEnv } from "@directus/env";
import { escapeRegExp } from "lodash-es";
import { resolvePackage } from "@directus/utils/node";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

//#region src/extensions/lib/get-shared-deps-mapping.ts
const __dirname = dirname(fileURLToPath(import.meta.url));
const getSharedDepsMapping = async (deps) => {
	const env = useEnv();
	const logger = useLogger();
	const appDir = await readdir(path.join(resolvePackage("@directus/app", __dirname), "dist", "assets"));
	const depsMapping = {};
	for (const dep of deps) {
		const depRegex = /* @__PURE__ */ new RegExp(`${escapeRegExp(dep.replace(/\//g, "_"))}\\.[a-zA-Z0-9_-]{8}\\.entry\\.js`);
		const depName = appDir.find((file) => depRegex.test(file));
		if (depName) depsMapping[dep] = new Url(env["PUBLIC_URL"]).addPath("admin", "assets", depName).toString({ rootRelative: true });
		else logger.warn(`Couldn't find shared extension dependency "${dep}"`);
	}
	return depsMapping;
};

//#endregion
export { getSharedDepsMapping };