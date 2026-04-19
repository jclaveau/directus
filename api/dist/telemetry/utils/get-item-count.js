import "knex";
import pLimit from "p-limit";

//#region src/telemetry/utils/get-item-count.ts
/**
* Get the item count of the given task in the given database
* @param db Knex instance to count against
* @param task Task to count rows for
* @returns Collection name and count
*/
const countCollection = async (db, task) => {
	const query = db.count("*", { as: "count" }).from(task.collection);
	if (task.where) query.where(...task.where);
	const count = await query.first();
	return {
		collection: task.collection,
		count: Number(count?.["count"] ?? 0)
	};
};
/**
* Merge the given collection count in the object accumulator
* Intended for use with .reduce()
* @param acc Accumulator
* @param value Current collection count object in array
* @returns Updated accumulator
*/
const mergeResults = (acc, value) => {
	acc[value.collection] = value.count;
	return acc;
};
/**
* Get an object of item counts for the given tasks
* @param db Database instance to get counts in
* @param tasks Array of tasks to get count for
*/
const getItemCount = async (db, tasks) => {
	const limit = pLimit(3);
	const calls = tasks.map((task) => limit(countCollection, db, task));
	return (await Promise.all(calls)).reduce(mergeResults, {});
};

//#endregion
export { countCollection, getItemCount, mergeResults };