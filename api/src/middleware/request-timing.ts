import { useEnv } from '@directus/env';
import { toBoolean } from '@directus/utils';
import type {
	ErrorRequestHandler,
	Express,
	NextFunction,
	Request,
	RequestHandler,
	Response,
} from 'express';
import { Histogram, register } from 'prom-client';

/**
 * Splits a request's wall time into the part spent inside our own handlers and
 * the part spent inside Express itself — the number the framework-port decision
 * (#458) turns on, which no hello-world benchmark can produce.
 *
 * Every app-level layer is wrapped so it reports when it was entered and when it
 * called `next()`. What is left over once those spans are subtracted from the
 * total is the router's own matching, dispatch and response machinery.
 */

type TimedLayer = {
	name: string;
	entry: number;
	exit: number | null;
};

type RequestTiming = {
	start: number;
	route: string;
	layers: TimedLayer[];
	reported: boolean;
};

type Phase = 'total' | 'framework' | 'middleware' | 'handler';

const PHASE_METRIC = 'directus_request_timing_phase_ms';
const LAYER_METRIC = 'directus_request_timing_layer_ms';

const BUCKETS = [
	0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000,
];

export const requestTimingEnabled = (): boolean =>
	toBoolean(useEnv()['REQUEST_TIMING_ENABLED']);

const timingOf = (res: Response): RequestTiming | undefined =>
	res.locals['requestTiming'];

const histogram = (name: string, help: string, label: string): Histogram => {
	const existing = register.getSingleMetric(name) as Histogram | undefined;

	if (existing) {
		return existing;
	}

	return new Histogram({
		name,
		help,
		labelNames: [label, 'route'],
		buckets: BUCKETS,
	});
};

/**
 * The mounted route group rather than the full path, so `/items/articles/42`
 * and `/items/articles` share a series instead of one per key.
 *
 * Read once on the way in: a mounted router strips its own prefix off `req.url`
 * for the duration of the layer, and a layer that answers instead of calling
 * `next()` never gets to put it back — by `res.end()` every mounted group would
 * otherwise report itself as `/`.
 */
const routeOf = (req: Request): string => `/${req.path.split('/')[1] ?? ''}`;

const durationsOf = (timing: RequestTiming, end: number): [string, number][] => {
	const { layers } = timing;

	return layers.map((layer, index) => {
		// A layer that never called `next()` either threw — the layer entered after
		// it bounds the span — or is the terminal one, which owns the rest of the
		// request.
		const stop = layer.exit ?? layers[index + 1]?.entry ?? end;

		return [layer.name, stop - layer.entry];
	});
};

const report = (res: Response, timing: RequestTiming): void => {
	const end = performance.now();
	const total = end - timing.start;

	const durations = durationsOf(timing, end);
	const inHandlers = durations.reduce((sum, [, ms]) => sum + ms, 0);

	// The last layer entered is the one that answered: a mounted router, the
	// not-found handler, or the error handler.
	const handler = durations.at(-1)?.[1] ?? 0;

	const phases: [Phase, number][] = [
		['total', total],
		['framework', Math.max(total - inHandlers, 0)],
		['middleware', inHandlers - handler],
		['handler', handler],
	];

	const { route } = timing;

	const phaseMetric = histogram(
		PHASE_METRIC,
		'Request wall time split into our handlers and Express itself',
		'phase',
	);

	const layerMetric = histogram(
		LAYER_METRIC,
		'Wall time owned by a single app-level Express layer',
		'layer',
	);

	for (const [phase, ms] of phases) {
		phaseMetric.observe({ phase, route }, ms);
	}

	for (const [layer, ms] of durations) {
		layerMetric.observe({ layer, route }, ms);
	}

	const header = useEnv()['REQUEST_TIMING_HEADER'];

	if (!header || res.headersSent) {
		return;
	}

	const round = (ms: number) => ms.toFixed(3);

	res.setHeader(`${header}`, [
		...phases.map(([phase, ms]) => `${phase}=${round(ms)}`),
		...durations.map(([layer, ms]) => `${layer}=${round(ms)}`),
	].join('; '));
};

/**
 * Starts the clock and reports at `res.end()` — the point the response is fully
 * built, so nothing but the socket write is left out. Must be the first layer.
 */
export const requestTiming: RequestHandler = (req, res, next) => {
	if (!requestTimingEnabled()) {
		return next();
	}

	const timing: RequestTiming = {
		start: performance.now(),
		route: routeOf(req),
		layers: [],
		reported: false,
	};

	res.locals['requestTiming'] = timing;

	const originalEnd = res.end.bind(res) as (...args: unknown[]) => Response;

	res.end = ((...args: unknown[]) => {
		if (timing.reported === false) {
			timing.reported = true;
			report(res, timing);
		}

		return originalEnd(...args);
	}) as Response['end'];

	return next();
};

const openLayer = (
	timing: RequestTiming,
	name: string,
	next: NextFunction,
): NextFunction => {
	const layer: TimedLayer = {
		name,
		entry: performance.now(),
		exit: null,
	};

	timing.layers.push(layer);

	return (err?: unknown) => {
		layer.exit = performance.now();
		next(err);
	};
};

const wrapHandler = (fn: RequestHandler, name: string): RequestHandler => {
	return (req: Request, res: Response, next: NextFunction) => {
		const timing = timingOf(res);

		if (!timing) {
			return fn(req, res, next);
		}

		return fn(req, res, openLayer(timing, name, next));
	};
};

/**
 * Express tells an error handler from a plain one by arity, so the wrapper has
 * to declare four parameters of its own or the error chain loses a link — and a
 * layer that threw would then run to the end of the request, charged with the
 * time its successor spent recovering.
 */
const wrapErrorHandler = (
	fn: ErrorRequestHandler,
	name: string,
): ErrorRequestHandler => {
	return (err: unknown, req: Request, res: Response, next: NextFunction) => {
		const timing = timingOf(res);

		if (!timing) {
			return fn(err, req, res, next);
		}

		return fn(err, req, res, openLayer(timing, name, next));
	};
};

const wrapLayer = (fn: RequestHandler, name: string): RequestHandler => {
	if (fn.length === 4) {
		return wrapErrorHandler(
			fn as unknown as ErrorRequestHandler,
			name,
		) as unknown as RequestHandler;
	}

	return wrapHandler(fn, name);
};

const REGISTRARS = ['use', 'get', 'post', 'patch', 'put', 'delete'] as const;

/**
 * Wraps every handler registered on the app from here on. Called before any
 * layer is mounted, and a no-op unless the probe is enabled — the wrappers cost
 * a closure and two `performance.now()` calls per layer per request.
 */
export const instrumentRequestTiming = (app: Express): void => {
	if (!requestTimingEnabled()) {
		return;
	}

	// Several layers are anonymous arrow functions mounted on no path; numbering
	// them by registration order keeps each one its own series instead of folding
	// the body parser, the logger and the redirect into a single `anonymous`.
	let anonymous = 0;

	for (const registrar of REGISTRARS) {
		const original = app[registrar].bind(app) as (...args: unknown[]) => unknown;

		(app as unknown as Record<string, unknown>)[registrar] = (
			...args: unknown[]
		) => {
			// `app.get('trust proxy')` reads a setting rather than mounting; it has
			// no handler to wrap and falls through untouched.
			const mount = typeof args[0] === 'string'
				? args[0]
				: '';

			return original(
				...args.map((arg) => {
					if (typeof arg !== 'function') {
						return arg;
					}

					const handler = arg as RequestHandler;
					const named = mount || handler.name;

					return wrapLayer(handler, named || `anonymous:${++anonymous}`);
				}),
			);
		};
	}
};
