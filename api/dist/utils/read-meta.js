//#region src/utils/read-meta.ts
/**
* Attach read metadata to a result via a non-enumerable `getMeta()`. The metadata rides the value
* without polluting the payload: invisible to `JSON.stringify`, spread enumeration, and the wire.
* Call this on the final returned value (after read hooks have run) so a rebuilt array can't strip it.
*/
function withMeta(value, meta) {
	Object.defineProperty(value, "getMeta", {
		value: () => meta,
		enumerable: false,
		configurable: true
	});
	return value;
}
/**
* The same value, without the meta rider in its type.
*
* Identity at runtime — the rider is still attached and `readMeta` still finds
* it. This is how a consumer that converts a read result into a domain type says
* it is done with the meta: `WithMeta<Item[]>` does not convert to `Permission[]`
* on its own, because the intersection carries a `getMeta` the target lacks.
*/
function withoutMeta(value) {
	return value;
}
/**
* Read the `ReadMeta` off a value previously tagged by `withMeta`, or `undefined` if absent (e.g. a
* hook returned a fresh object that dropped the rider, or the value never went through a read).
*/
function readMeta(value) {
	if (value !== null && typeof value === "object" && typeof value.getMeta === "function") return value.getMeta();
}

//#endregion
export { readMeta, withMeta, withoutMeta };