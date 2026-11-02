import { DatabaseHelper } from "../types.js";

//#region src/database/helpers/sequence/types.ts
var AutoSequenceHelper = class extends DatabaseHelper {
	async resetAutoIncrementSequence(_table, _column) {}
	/**
	* Raises the auto increment sequence so the next value it hands out sits above
	* `providedValue`. Engines that advance the counter on an explicit insert of their
	* own accord, such as MySQL and SQLite, need nothing here.
	*/
	async raiseAutoIncrementSequence(_table, _column, _providedValue) {}
};

//#endregion
export { AutoSequenceHelper };