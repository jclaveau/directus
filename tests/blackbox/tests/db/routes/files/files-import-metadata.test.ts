import { paths } from '@common/config';
import { freePortOfWorker } from '@utils/free-port-of-worker';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { defineSpawnedWriteFeature } from '../system/spawned-write-steps';

const imageServer: { server?: Server; url?: string } = {};

defineSpawnedWriteFeature(
	'./tests/db/routes/files/files-import-metadata.feature',
	{
		envOverrides: {
			// Only the cloud metadata address: the image server is local.
			IMPORT_IP_DENY_LIST: '169.254.169.254',
			FILE_METADATA_ALLOW_LIST: 'iptc,xmp',
		},
		async beforeFeature() {
			const imageBytes = await readFile(
				join(paths.cwd, 'assets', 'iptc-xmp.jpg'),
			);

			const port = await freePortOfWorker();

			imageServer.server = createServer((_incoming, outgoing) => {
				outgoing.writeHead(200, { 'Content-Type': 'image/jpeg' });
				outgoing.end(imageBytes);
			});

			await new Promise<void>((resolve) => {
				imageServer.server!.listen(port, '127.0.0.1', resolve);
			});

			imageServer.url = `http://127.0.0.1:${port}`;
		},
		async afterFeature() {
			await new Promise<void>((resolve, reject) => {
				imageServer.server!.close((error) => {
					if (error) {
						reject(error);
					}
					else {
						resolve();
					}
				});
			});
		},
		knownKeys() {
			return { image_server: imageServer.url! };
		},
	},
);
