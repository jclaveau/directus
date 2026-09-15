import { parseJSON } from '@directus/utils/values';

export const tryJson = (value: unknown) => {
	try {
		return parseJSON(String(value)) as unknown;
	} catch {
		return value;
	}
};
