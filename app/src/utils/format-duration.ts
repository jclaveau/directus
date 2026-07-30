/**
 * Turns a duration in seconds into a compact human-readable string, largest unit
 * first, omitting zero parts.
 *
 * @param seconds - Duration in seconds
 *
 * @example
 * ```js
 * formatDuration(3600); // => "1h"
 * formatDuration(90);   // => "1m 30s"
 * formatDuration(0);    // => "0s"
 * ```
 */
export function formatDuration(seconds: number): string {
	const total = Math.round(seconds);

	if (total <= 0) {
		return '0s';
	}

	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = total % 60;

	const parts: string[] = [];

	if (hours) {
		parts.push(`${hours}h`);
	}

	if (minutes) {
		parts.push(`${minutes}m`);
	}

	if (secs) {
		parts.push(`${secs}s`);
	}

	return parts.join(' ');
}
