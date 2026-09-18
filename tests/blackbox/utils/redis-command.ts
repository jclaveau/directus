import net from 'node:net';

/**
 * Send one Redis command over a plain socket and resolve its reply.
 *
 * The blackbox suite carries no Redis client, and the few tests that need to reach
 * the tag index directly — to plant a refusal, or to inflate a set until a sweep
 * takes long enough to race — need only this. Encoded as RESP multi-bulk rather
 * than inline so an argument list can be arbitrarily long and carry any bytes.
 */
export function redisCommand(
	port: number,
	args: readonly string[],
): Promise<string> {
	const payload = [
		`*${args.length}\r\n`,
		...args.map((arg) => `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`),
	].join('');

	return new Promise((resolve, reject) => {
		const socket = net.createConnection(
			{ host: '127.0.0.1', port },
			() => socket.write(payload),
		);

		let reply = '';

		socket.on('data', (chunk) => {
			reply += chunk.toString();

			// Every reply these tests issue is a single line (`+OK`, `:1`, `-ERR …`),
			// so the first terminator is the whole answer.
			if (reply.includes('\r\n')) {
				socket.end();
				resolve(reply.trim());
			}
		});

		socket.on('error', reject);
	});
}
