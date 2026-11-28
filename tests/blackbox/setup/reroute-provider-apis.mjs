import http from 'node:http';
import https from 'node:https';

// create-providers gives each provider's client only its key, and both clients
// read `https.request` at each call: this sends those to the fake providers a
// suite started on BLACKBOX_PROVIDERS_PORT, over plain http so without their agent.
const REROUTED_HOSTS = ['api.mollie.com', 'api.stripe.com'];

const httpsRequest = https.request;

https.request = (requestOptions, ...requestArguments) => {
	const requestHost = requestOptions.hostname ?? requestOptions.host;

	if (!REROUTED_HOSTS.includes(requestHost)) {
		return httpsRequest(requestOptions, ...requestArguments);
	}

	return http.request(
		{
			...requestOptions,
			agent: undefined,
			protocol: 'http:',
			host: '127.0.0.1',
			hostname: '127.0.0.1',
			port: process.env['BLACKBOX_PROVIDERS_PORT'],
		},
		...requestArguments,
	);
};
