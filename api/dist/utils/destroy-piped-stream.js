//#region src/utils/destroy-piped-stream.ts
/**
* Destroy the targetStream that is being piped into without destroying the sourceStream.
* (╯°□°）╯︵ ┻━┻
*/
function destroyPipedStream(targetStream, sourceStream) {
	sourceStream.unpipe(targetStream);
	targetStream.destroy();
	sourceStream.resume();
}

//#endregion
export { destroyPipedStream };