/**
 * Template tag that renders a wrapped source string as a single line: every run of whitespace
 * containing a newline collapses to one space, and the ends are trimmed. Lets a long string (e.g. a
 * test title) be written across several indented source lines — readable, and under a column cap —
 * while the value stays a single line.
 *
 *     oneLine`
 *         null scopedCacheTags falls back to a full flush (unresolvable mutation)
 *     `
 *     // → 'null scopedCacheTags falls back to a full flush (unresolvable mutation)'
 */
export function oneLine(strings: TemplateStringsArray, ...values: unknown[]): string {
	let raw = '';

	for (let index = 0; index < strings.length; index++) {
		raw += strings[index];

		if (index < values.length) {
			raw += String(values[index]);
		}
	}

	// Collapse every newline-bearing whitespace run to a single space, keeping intra-line spacing.
	// Done by splitting on newlines and trimming each line (rather than a `\s*\n\s*` regex, whose
	// overlapping quantifiers backtrack polynomially — a ReDoS vector on library input): trimming
	// drops the surrounding indentation and any stray CR, and empty lines fall out.
	return raw
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '')
		.join(' ');
}
