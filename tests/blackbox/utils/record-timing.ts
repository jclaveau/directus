import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const timingsDir = join(
	dirname(fileURLToPath(import.meta.url)),
	'..',
	'timings',
);

/**
 * Appends one line to `timings/<stream>.jsonl`, the record CI uploads with every
 * shard. Never throws: a timing that cannot be written is not a test failure.
 */
export function recordTiming(
	stream: string,
	entry: Record<string, unknown>,
): void {
	try {
		mkdirSync(timingsDir, { recursive: true });

		appendFileSync(
			join(timingsDir, `${stream}.jsonl`),
			`${JSON.stringify({ at: Date.now(), ...entry })}\n`,
		);
	}
	catch {
		// The timings are a diagnostic, the run goes on without them.
	}
}
