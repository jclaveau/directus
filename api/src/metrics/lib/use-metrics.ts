import { useEnv } from '@directus/env';
import { toBoolean } from '@directus/utils/values';
import { createMetrics } from './create-metrics.js';
import { _cache } from './instance.js';

export { _cache };

export const useMetrics = () => {
	const env = useEnv();

	if (!toBoolean(env['METRICS_ENABLED'])) {
		return;
	}

	if (_cache.metrics) {
		return _cache.metrics;
	}

	_cache.metrics = createMetrics();

	return _cache.metrics;
};
