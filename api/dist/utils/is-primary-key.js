//#region src/utils/is-primary-key.ts
/**
* Whether a value is usable as a primary key.
*
* A value read out of a payload by a runtime field name is `any` as far as the
* compiler knows, so this is what gets it to `PrimaryKey` by proof rather than
* by assertion. Whether it is the *right* kind of key for its collection — a
* uuid where the schema says uuid, an integer where it says integer — is
* `validateKeys`, which every write path calls on the keys it is about to use.
*
* Deliberately not schema-aware, and it cannot be at the type level: which field
* is the primary key lives in `SchemaOverview.primary`, a runtime `string`, and
* an `Item` type is `Record<string, any>` — neither carries the key's field name
* nor its type, so no generic can narrow this past `string | number`.
*/
function isPrimaryKey(value) {
	return typeof value === "string" || typeof value === "number";
}

//#endregion
export { isPrimaryKey };