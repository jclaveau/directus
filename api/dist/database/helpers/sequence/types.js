import { DatabaseHelper } from "../types.js";

//#region src/database/helpers/sequence/types.ts
var AutoSequenceHelper = class extends DatabaseHelper {
	async resetAutoIncrementSequence(_table, _column) {}
};

//#endregion
export { AutoSequenceHelper };