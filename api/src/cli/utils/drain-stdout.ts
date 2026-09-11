/**
 * Wait for what has been logged to leave the process.
 *
 * `process.exit` discards whatever the stream still holds, and stdout is only
 * written synchronously when it is a TTY — piped into a deploy log or a CI step it
 * is not, so the outcome line the caller reads the run's result from is the first
 * thing an immediate exit loses. An empty chunk is enough: the callback runs behind
 * the ones already queued.
 */
export function drainStdout(
	stream: NodeJS.WriteStream = process.stdout,
): Promise<void> {
	return new Promise((resolve) => {
		stream.write('', () => resolve());
	});
}
