import { _cache } from '@directus/env';

export default (router) => {
	router.post('/set', (req, res) => {
		if (!_cache.env) {
			return res.status(500).json({ errors: [{ message: 'env cache not initialized' }] });
		}

		const { key, value } = req.body ?? {};

		if (typeof key !== 'string' || key.length === 0) {
			return res.status(400).json({ errors: [{ message: 'missing string "key"' }] });
		}

		_cache.env[key] = value;
		res.json({ data: { key, value } });
	});
};
