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

	// Collapse every whitespace run that contains a newline (so CRLF and trailing indentation go
	// too) to a single space; intra-line spacing, having no newline, is left untouched.
	return raw.replace(/\s*\n\s*/g, ' ').trim();
}
