// The tag stays raw (it IS the Redis key), so percent-encode at the exits: a
// bare NUL or >= U+0100 char otherwise makes res.setHeader / a text column throw.
export function printableScopedCacheTags(serialized: string): string {
	return Array.from(serialized)
		.map((char) => {
			const code = char.charCodeAt(0);

			return code >= 0x20 && code <= 0x7E
				? char
				: encodeURIComponent(char);
		})
		.join('');
}
