import http from 'node:http';
import https from 'node:https';

// create-providers gives the Mollie client only its key, and that client calls
// node-fetch, which reads `https.request` at each call: this sends those to
// the fake Mollie
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
