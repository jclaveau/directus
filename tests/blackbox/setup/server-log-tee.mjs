// Preloaded into every Directus the suite spawns (config.ts adds it to
// NODE_OPTIONS when TEST_SAVE_LOGS is set). Most suites spawn their own
// instance and never read its output, so a failure in one left no server-side
// trace: this copies everything the process writes to one file per process,
// which CI uploads as an artifact whatever the outcome.
//
// It only copies. What reaches stdout and stderr is unchanged, so a suite that
// parses a CLI's output reads exactly what it read before.
import fs from 'node:fs';
import path from 'node:path';

const logDirectory = process.env['BLACKBOX_SERVER_LOG_DIR'];

if (logDirectory) {
	fs.mkdirSync(logDirectory, { recursive: true });

	// The namespace names the suite for every instance that sets its own, and the
	// pid tells apart two processes a suite starts on the same port.
	const logName = [
		process.argv[2] ?? 'node',
		process.env['CACHE_NAMESPACE'] ?? 'default',
		process.env['PORT'] ?? 'noport',
		process.pid,
	].join('-');

	const logDescriptor = fs.openSync(
		path.join(logDirectory, `${logName}.log`),
		'a',
	);

	const originalWriteSync = fs.writeSync;
	let copyingStreamWrite = false;

	const copyToLog = (chunk) => {
		try {
			originalWriteSync(logDescriptor, chunk);
		}
		catch {
			// A log that cannot be written must never fail the server it watches.
		}
	};

	copyToLog(
		`# ${new Date().toISOString()} pid ${process.pid} `
		+ `argv ${process.argv.slice(1).join(' ')}\n`,
	);

	// Node prints a crash's stack natively, past both hooks below. The monitor
	// only observes: the process still dies exactly as it would have.
	process.on('uncaughtExceptionMonitor', (error, origin) => {
		copyToLog(`# ${origin}: ${error?.stack ?? error}\n`);
	});

	// pino-pretty writes the application log straight to fd 1 through
	// fs.writeSync (sonic-boom), past process.stdout.
	fs.writeSync = function writeSyncCopied(fd, buffer, ...rest) {
		if ((fd === 1 || fd === 2) && !copyingStreamWrite) {
			copyToLog(buffer);
		}

		return originalWriteSync.call(fs, fd, buffer, ...rest);
	};

	// pino-http and console.* go through the streams. A stream bound to a file
	// (stdio 'ignore' is /dev/null) ends in fs.writeSync itself, hence the flag.
	for (const outputStream of [process.stdout, process.stderr]) {
		const originalStreamWrite = outputStream.write.bind(outputStream);

		outputStream.write = function streamWriteCopied(chunk, ...rest) {
			copyToLog(chunk);
			copyingStreamWrite = true;

			try {
				return originalStreamWrite(chunk, ...rest);
			}
			finally {
				copyingStreamWrite = false;
			}
		};
	}
}
