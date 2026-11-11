//#region src/utils/answer-once.ts
/**
* A multipart body cut inside a part fails twice: in the parser, then in what
* reads the part. The route answers the first one; the later calls are dropped.
*/
function answerOnce(next) {
	let isAnswered = false;
	return (error) => {
		if (isAnswered) return;
		isAnswered = true;
		next(error);
	};
}

//#endregion
export { answerOnce };