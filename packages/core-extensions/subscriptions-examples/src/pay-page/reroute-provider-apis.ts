import http from 'node:http';
import https from 'node:https';

const REROUTED_HOSTS = ['api.mollie.com', 'api.stripe.com'];

const REROUTE_MARK = Symbol.for('@scalabus/subscriptions-examples/reroute');

type HttpsRequest = typeof https.request & { [REROUTE_MARK]?: true };

/**
 * Both provider clients read `https.request` at each call: this sends those to
 * the fake providers on `providersPort`, over plain http so without their
 * agent. Once per process, however many times the endpoint registers.
 */
export function rerouteProviderApis(providersPort: number): void {
	const httpsRequest = https.request as HttpsRequest;

	if (httpsRequest[REROUTE_MARK] === true) {
		return;
	}

	const reroutedRequest = ((
		requestOptions: http.RequestOptions | string | URL,
		...requestArguments: unknown[]
	) => {
		const requestHost = typeof requestOptions === 'object'
			&& !(requestOptions instanceof URL)
			? requestOptions.hostname ?? requestOptions.host
			: null;

		if (typeof requestOptions !== 'object'
			|| requestOptions instanceof URL
			|| !REROUTED_HOSTS.includes(requestHost ?? '')) {
			return (httpsRequest as (...callArguments: unknown[]) => unknown)(
				requestOptions,
				...requestArguments,
			);
		}

		return (http.request as (...callArguments: unknown[]) => unknown)(
			{
				...requestOptions,
				agent: undefined,
				protocol: 'http:',
				host: '127.0.0.1',
				hostname: '127.0.0.1',
				port: providersPort,
			},
			...requestArguments,
		);
	}) as HttpsRequest;

	reroutedRequest[REROUTE_MARK] = true;
	https.request = reroutedRequest;
}
