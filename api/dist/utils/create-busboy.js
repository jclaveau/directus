import Busboy from "busboy";

//#region src/utils/create-busboy.ts
/**
* A body ending inside a part destroys that part with an error, and the parser
* reports the same error. A part nothing reads (access or type refused, or a
* consumer still awaiting something) still gets an error listener, so that error
* is reported once, by the parser.
*/
function createBusboy(request, config) {
	const busboy = Busboy(config);
	busboy.on("file", (_fieldname, fileStream) => {
		fileStream.on("error", () => void 0);
	});
	busboy.on("error", () => {
		request.resume();
		busboy.destroy();
	});
	if (request.destroyed && request.complete === false) busboy.destroy();
	else request.once("close", () => {
		if (request.complete === false) busboy.destroy();
	});
	return busboy;
}

//#endregion
export { createBusboy };