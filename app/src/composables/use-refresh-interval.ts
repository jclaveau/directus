import { useLocalStorage } from '@vueuse/core';

/**
 * The auto-refresh interval a page was left on, in seconds, `null` being off.
 *
 * Kept in local storage so a page an operator watches — and reloads all day —
 * comes back refreshing at the rate they chose rather than not at all.
 *
 * The serializer is spelled out because vueuse picks one from the default
 * value, and for `null` that is the identity: the interval would come back as
 * the string `'30'` where the sidebar's model is a number, and nothing would
 * ever arm.
 */
export function useRefreshInterval(key: string) {
	return useLocalStorage<number | null>(key, null, {
		serializer: {
			read: (value) => {
				return value
					? Number(value)
					: null;
			},
			write: (value) => {
				return value === null
					? ''
					: String(value);
			},
		},
	});
}
