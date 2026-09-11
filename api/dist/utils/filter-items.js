import { generateJoi } from "@directus/utils";

//#region src/utils/filter-items.ts
function filterItems(items, filter) {
	if (!filter) return items;
	return items.filter((item) => passesFilter(item, filter));
	function passesFilter(item, filter$1) {
		if (!filter$1 || Object.keys(filter$1).length === 0) return true;
		if (Object.keys(filter$1)[0] === "_and") return Object.values(filter$1)[0].every((subFilter) => {
			return passesFilter(item, subFilter);
		});
		else if (Object.keys(filter$1)[0] === "_or") return Object.values(filter$1)[0].some((subFilter) => {
			return passesFilter(item, subFilter);
		});
		else {
			const { error } = generateJoi(filter$1).validate(item);
			return error === void 0;
		}
	}
}

//#endregion
export { filterItems };