/**
 * How a series of samples becomes a reported figure.
 *
 * Shared by every bench here so two of them can be read side by side: a median in
 * one table means the same thing as a median in the next, and a change to how the
 * percentile is picked moves both at once rather than silently splitting them.
 */

export type Summary = {
	name: string;
	samples: number[];
	min: number;
	median: number;
	p95: number;
	max: number;
};

export function summarise(name: string, samples: number[]): Summary {
	if (samples.length === 0) {
		throw new Error(`The series "${name}" has no samples to summarise.`);
	}

	const sorted = [...samples].sort((a, b) => a - b);

	const at = (fraction: number) =>
		sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;

	return {
		name,
		samples,
		min: sorted[0]!,
		median: at(0.5),
		p95: at(0.95),
		max: sorted[sorted.length - 1]!,
	};
}

/**
 * Rounded to a tenth rather than a whole: a request path measured in single-digit
 * milliseconds loses a quarter of its resolution to whole-millisecond rounding, and
 * the ratios below are read off these numbers.
 */
function figure(value: number): string {
	return value.toFixed(1);
}

export function summaryRow(summary: Summary, unit = 'ms'): string {
	return `| ${summary.name} | ${figure(summary.min)} ${unit}`
		+ ` | **${figure(summary.median)} ${unit}** | ${figure(summary.p95)} ${unit}`
		+ ` | ${figure(summary.max)} ${unit} |`;
}
