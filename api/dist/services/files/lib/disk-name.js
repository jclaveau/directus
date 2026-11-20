//#region src/services/files/lib/disk-name.ts
/**
* Why a `filename_disk` is refused, or null when it is a normalised relative
* path. A driver resolves the name under its root, so `/a`, `./a` or `a/../b`
* would reach a file the row doesn't name.
*/
function unnormalisedDiskNameReason(filenameDisk) {
	if (filenameDisk === "") return "\"filename_disk\" can't be empty";
	if (filenameDisk.split("/").every((pathSegment) => {
		return ![
			"",
			".",
			".."
		].includes(pathSegment);
	})) return null;
	return `"filename_disk" "${filenameDisk}" must be a relative path without empty, "." or ".." segments`;
}

//#endregion
export { unnormalisedDiskNameReason };