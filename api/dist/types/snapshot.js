//#region src/types/snapshot.ts
/**
* Indicates the kind of change based on comparisons by deep-diff package
*/
const DiffKind = {
	NEW: "N",
	DELETE: "D",
	EDIT: "E",
	ARRAY: "A"
};

//#endregion
export { DiffKind };