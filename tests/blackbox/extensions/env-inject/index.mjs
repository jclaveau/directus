import { cast } from '@directus/env';

export default (router, { env }) => {
	router.post('/set', (req, res) => {
		if (!env) {
			return res.status(500).json({ errors: [{ message: 'env not provided in extension context' }] });
		}

		const { key, value } = req.body ?? {};

		if (typeof key !== 'string' || key.length === 0) {
			return res.status(400).json({ errors: [{ message: 'missing string "key"' }] });
		}

		// Cast exactly as @directus/env would on a real env var (type-map + guess),
		// so an injected value is typed the same as one loaded from the environment.
		env[key] = cast(value, key);
		res.json({ data: { key, value: env[key] } });
	});
};
