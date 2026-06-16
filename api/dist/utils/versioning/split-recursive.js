import { isPlainObject } from "lodash-es";

//#region src/utils/versioning/split-recursive.ts
function splitRecursive(object) {
	if (isPlainObject(object) && typeof object === "object" && object !== null) {
		const { _user, _date,...rest } = object;
		const defaultOverwrites = {
			_user,
			_date
		};
		for (const key in rest) {
			const { rawDelta, defaultOverwrites: innerDefaultOverwrites } = splitRecursive(rest[key]);
			rest[key] = rawDelta;
			if (innerDefaultOverwrites) defaultOverwrites[key] = innerDefaultOverwrites;
			else if (Array.isArray(rest[key]) && _user !== void 0 && _date !== void 0) defaultOverwrites[key] = {
				_user,
				_date
			};
		}
		return {
			rawDelta: rest,
			defaultOverwrites
		};
	} else if (Array.isArray(object)) {
		const rest = [];
		const defaultOverwrites = [];
		for (const key in object) {
			const { rawDelta, defaultOverwrites: innerDefaultOverwrites } = splitRecursive(object[key]);
			rest[key] = rawDelta;
			if (innerDefaultOverwrites) defaultOverwrites[key] = innerDefaultOverwrites;
		}
		return {
			rawDelta: rest,
			defaultOverwrites: defaultOverwrites.length > 0 ? defaultOverwrites : void 0
		};
	}
	return {
		rawDelta: object,
		defaultOverwrites: void 0
	};
}

//#endregion
export { splitRecursive };