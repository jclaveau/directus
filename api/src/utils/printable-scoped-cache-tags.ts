// A header rejects control bytes and a text column rejects the NUL opening the
// NULL token. The tag stays raw — it IS the Redis key — so escape at the exits.
export function printableScopedCacheTags(serialized: string): string {
	return Array.from(serialized)
		.map((char) => {
			const code = char.charCodeAt(0);

			if (code >= 0x20 && code !== 0x7F) {
				return char;
			}

			const hex = code.toString(16).padStart(2, '0');

			return `%${hex.toUpperCase()}`;
		})
		.join('');
}
