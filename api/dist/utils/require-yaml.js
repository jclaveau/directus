import { requireText } from "./require-text.js";
import yaml from "js-yaml";

//#region src/utils/require-yaml.ts
function requireYAML(filepath) {
	const yamlRaw = requireText(filepath);
	return yaml.load(yamlRaw);
}

//#endregion
export { requireYAML };