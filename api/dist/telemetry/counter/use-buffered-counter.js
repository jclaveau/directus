import { useLogger } from "../../logger/index.js";
import { useCounters } from "./use-counters.js";

//#region src/telemetry/counter/use-buffered-counter.ts
const DEFAULT_OPTIONS = {
	maxBucketSize: 100,
	flushIntervalMs: 5e3
};
const _bufferedCounterCache = {};
/**
* Returns a buffered counter bound to a counter namespace (e.g. "requests").
* Internally manages independent buckets per sub-key (e.g. "GET", "POST").
*
* @param key - The counter namespace (e.g. "requests").
* @param options - Optional bucket size and interval configuration.
*/
const useBufferedCounter = (key, options) => {
	const logger = useLogger();
	if (!_bufferedCounterCache[key]) {
		const opts = {
			...DEFAULT_OPTIONS,
			...options
		};
		const flusherEntry = {
			counters: {},
			options: opts,
			timer: null
		};
		flusherEntry.timer = setInterval(() => {
			for (const [subKey, state] of Object.entries(flusherEntry.counters)) if (state.count > 0 && !state.flushing) flush(subKey);
		}, opts.flushIntervalMs);
		if (flusherEntry.timer && typeof flusherEntry.timer === "object" && "unref" in flusherEntry.timer) flusherEntry.timer.unref();
		_bufferedCounterCache[key] = flusherEntry;
	}
	const flusher = _bufferedCounterCache[key];
	const counter = useCounters();
	const getOrCreateState = (subKey) => {
		let state = flusher.counters[subKey];
		if (!state) {
			state = {
				count: 0,
				flushing: false
			};
			flusher.counters[subKey] = state;
		}
		return state;
	};
	const flush = async (subKey) => {
		const state = flusher.counters[subKey];
		if (!state || state.count <= 0 || state.flushing) return;
		state.flushing = true;
		const amount = state.count;
		state.count = 0;
		try {
			await counter.increment(`${key}:${subKey}`, amount);
		} catch (err) {
			state.count += amount;
			logger.error(`Failed to flush buffered counter for ${key}:${subKey}`, err);
		} finally {
			state.flushing = false;
		}
	};
	const flushAll = async () => {
		await Promise.all(Object.keys(flusher.counters).map((subKey) => flush(subKey)));
	};
	const terminate = async () => {
		if (flusher.timer) {
			clearInterval(flusher.timer);
			flusher.timer = null;
		}
		try {
			await flushAll();
		} catch {} finally {
			flusher.counters = {};
			_bufferedCounterCache[key] = null;
		}
	};
	/**
	* Flush all buffered counts to the counter, read back every sub-key's
	* total, and reset them all to 0 in the counter. Returns a record of
	* sub-key → count.
	*
	* @param expectedKeys - Optional explicit list of sub-keys to always
	*   include when reading/resetting. Ensures keys tracked by other
	*   processes (but not seen locally) are still captured.
	*/
	const getAndResetAll = async (expectedKeys) => {
		await flushAll();
		const localKeys = Object.keys(flusher.counters);
		const subKeys = expectedKeys ? [...new Set([...localKeys, ...expectedKeys])] : localKeys;
		const result = {};
		for (const subKey of subKeys) result[subKey] = await counter.get(`${key}:${subKey}`) ?? 0;
		await Promise.all(subKeys.map((subKey) => {
			if (result[subKey] > 0) return counter.increment(`${key}:${subKey}`, -result[subKey]);
			return Promise.resolve();
		}));
		return result;
	};
	return {
		increment(subKey, amount = 1) {
			const state = getOrCreateState(subKey);
			state.count += amount;
			if (state.count >= flusher.options.maxBucketSize) flush(subKey);
		},
		flush,
		flushAll,
		getAndResetAll,
		terminate
	};
};
/**
* Terminate all buffered counters by flushing their counts and clearing their timers.
* Call this on application shutdown to ensure all buffered counts are flushed.
*/
const terminateAllBufferedCounters = async () => {
	await Promise.all(Object.keys(_bufferedCounterCache).map((key) => {
		if (_bufferedCounterCache[key]) return useBufferedCounter(key).terminate();
	}));
};

//#endregion
export { _bufferedCounterCache, terminateAllBufferedCounters, useBufferedCounter };