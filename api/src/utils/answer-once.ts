import type { NextFunction } from 'express';

/**
 * A multipart body cut inside a part fails twice: in the parser, then in what
 * reads the part. The route answers the first one; the later calls are dropped.
 */
export function answerOnce(next: NextFunction): (error?: unknown) => void {
	let isAnswered = false;

	return (error?: unknown) => {
		if (isAnswered) {
			return;
		}

		isAnswered = true;
		next(error);
	};
}
