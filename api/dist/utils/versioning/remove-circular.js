//#region src/utils/versioning/remove-circular.ts
function removeCircular(obj, seen = /* @__PURE__ */ new WeakSet()) {
	if (assertIsRecord(obj)) {
		if (seen.has(obj)) return null;
		seen.add(obj);
		for (const key in obj) if (typeof obj[key] === "object") {
			if (removeCircular(obj[key], seen) === null) delete obj[key];
		}
	}
	return obj;
}
function assertIsRecord(val) {
	return typeof val === "object" && val !== null;
}

//#endregion
export { removeCircular };