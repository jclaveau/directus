// A hook mounting a route on the app itself, outside the endpoint router:
// `edge allow-list` reads it by handing the hooks an app through the same init
// events `createApp` emits.
export default function registerHooks({ init }) {
	init('routes.custom.after', ({ app }) => {
		app.get('/edge-hooked/ping', (_request, response) => response.send('pong'));
	});
}
