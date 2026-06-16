import { cloneDeep } from "lodash-es";

//#region src/utils/versioning/merge-version-data.ts
function mergeVersionsRaw(item, versionData) {
	const result = cloneDeep(item);
	for (const versionRecord of versionData) for (const key of Object.keys(versionRecord)) result[key] = versionRecord[key];
	return result;
}

//#endregion
export { mergeVersionsRaw };