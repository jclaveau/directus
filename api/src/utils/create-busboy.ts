import Busboy, { type BusboyConfig, type Busboy as BusboyParser } from 'busboy';
import type { IncomingMessage } from 'node:http';

/**
 * A body ending inside a part destroys that part with an error, and the parser
 * reports the same error. On a part nothing reads (access or type refused, or a
 * consumer still awaiting something) the first one would be uncaught, which ends
 * the process.
 */
export function createBusboy(
	request: IncomingMessage,
	config: BusboyConfig,
): BusboyParser {
	const busboy = Busboy(config);

	busboy.on('file', (_fieldname, fileStream) => {
		fileStream.on('error', () => undefined);
	});

	// Nothing ends the part of an aborted request, and an import reading it holds
	// its transaction until it ends.
	request.once('close', () => {
		if (request.complete === false) {
			busboy.destroy();
		}
	});

	return busboy;
}
