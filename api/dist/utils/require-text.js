import fse from "fs-extra";

//#region src/utils/require-text.ts
function requireText(filepath) {
	return fse.readFileSync(filepath, "utf8");
}

//#endregion
export { requireText };