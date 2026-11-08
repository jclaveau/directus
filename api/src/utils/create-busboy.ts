import Busboy, { type BusboyConfig, type Busboy as BusboyParser } from 'busboy';
import type { IncomingMessage } from 'node:http';

/**
 * A body ending inside a part destroys that part with an error, and the parser
 * reports the same error. A part nothing reads (access or type refused, or a
 * consumer still awaiting something) still gets an error listener, so that error
 * is reported once, by the parser.
 */
export function createBusboy(
	request: IncomingMessage,
	config: BusboyConfig,
): BusboyParser {
	const busboy = Busboy(config);

	busboy.on('file', (_fieldname, fileStream) => {
		fileStream.on('error', () => undefined);
	});

	// Once the route answers an error, the pipe stops feeding the parser and the
	// rest of the body would sit unread, and a part still being read would never
	// end: drain the body and fail that part.
	busboy.on('error', () => {
		request.resume();
		busboy.destroy();
	});

	// Nothing ends the part of an aborted request, and an import reading it holds
	// its transaction until it ends. An import creates its parser only once the
	// transaction is open, by which time the request may already be aborted.
	if (request.destroyed && request.complete === false) {
		busboy.destroy();
	}
	else {
		request.once('close', () => {
			if (request.complete === false) {
				busboy.destroy();
			}
		});
	}

	return busboy;
}
