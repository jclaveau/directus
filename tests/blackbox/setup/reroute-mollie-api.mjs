import http from 'node:http';
import https from 'node:https';

// The Mollie client has no setting for its host and calls node-fetch, which
// reads `https.request` at each call: this sends its calls to the fake Mollie
// a suite started on BLACKBOX_MOLLIE_PORT, over plain http so without its agent.
const httpsRequest = https.request;

https.request = (requestOptions, ...requestArguments) => {
	if (requestOptions.hostname !== 'api.mollie.com') {
		return httpsRequest(requestOptions, ...requestArguments);
	}

	return http.request(
		{
			...requestOptions,
			agent: undefined,
			protocol: 'http:',
			host: '127.0.0.1',
			hostname: '127.0.0.1',
			port: process.env['BLACKBOX_MOLLIE_PORT'],
		},
		...requestArguments,
	);
};
