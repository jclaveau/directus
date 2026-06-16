import { getSchema } from "../../utils/get-schema.js";
import { getItemCount } from "./get-item-count.js";
import "knex";
import { isSystemCollection } from "@directus/system-data";

//#region src/telemetry/utils/get-user-item-count.ts
/**
* Sum all passed values together. Meant to be used with .reduce()
*/
const sum = (acc, val) => acc += val;
/**
* Count all the items in the non-system tables
*/
const getUserItemCount = async (db) => {
	const schema = await getSchema({ database: db });
	const userCollections = Object.keys(schema.collections).filter((collection) => isSystemCollection(collection) === false).map((collection) => ({ collection }));
	const counts = await getItemCount(db, userCollections);
	return {
		collections: userCollections.length,
		items: Object.values(counts).reduce(sum, 0)
	};
};

//#endregion
export { getUserItemCount, sum };