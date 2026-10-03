import fse from "fs-extra";
import yaml from "js-yaml";

//#region src/utils/require-yaml.ts
function requireYAML(filepath) {
	const yamlRaw = fse.readFileSync(filepath, "utf8");
	return yaml.load(yamlRaw);
}

//#endregion
export { requireYAML };