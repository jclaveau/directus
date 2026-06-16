import sanitize from "sanitize-filename";

//#region src/services/assets/name-deduper.ts
const DEFAULT_GROUP = Symbol("undefined");
var NameDeduper = class {
	map = {};
	add(name, options) {
		name = sanitize(name ?? "") || options?.fallback;
		if (!name) throw Error("Invalid \"name\" provided");
		const groupKey = options?.group ?? DEFAULT_GROUP;
		const match = this.map[groupKey]?.[name];
		if (match) {
			const dedupedName = `${name} (${match})`;
			this.map[groupKey][name] += 1;
			return dedupedName;
		}
		if (!this.map[groupKey]) this.map[groupKey] = {};
		this.map[groupKey][name] = 1;
		return name;
	}
};

//#endregion
export { NameDeduper };