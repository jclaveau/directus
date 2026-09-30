//#region src/utils/get-string-byte-size.ts
/**
* Returns the byte size for a given input string
*/
function stringByteSize(string) {
	return Buffer.byteLength(string, "utf-8");
}

//#endregion
export { stringByteSize };