export function readThrownMessage(thrownError: unknown): string {
	return thrownError instanceof Error
		? thrownError.message
		: String(thrownError);
}
