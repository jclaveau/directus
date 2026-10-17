/**
 * Why a `filename_disk` is refused, or null when it is a normalised relative
 * path. A driver resolves the name under its root, so `/a`, `./a` or `a/../b`
 * would reach a file the row doesn't name.
 */
export function unnormalisedDiskNameReason(filenameDisk: string): string | null {
	const isNormalised = filenameDisk.split('/').every((pathSegment) => {
		return !['', '.', '..'].includes(pathSegment);
	});

	if (isNormalised) {
		return null;
	}

	return `"filename_disk" "${filenameDisk}" must be a relative path`
		+ ' without empty, "." or ".." segments';
}
