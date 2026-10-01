// A named endpoint, mounted by the extension manager on the extension's name:
// `edge allow-list` reads that mount off the endpoint router.
export default function registerEndpoint(router) {
	router.get('/ping', (_request, response) => response.send('pong'));
}
