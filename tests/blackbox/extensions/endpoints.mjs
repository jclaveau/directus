import { Router } from 'express';
import { importFolderDefaults } from './folder-defaults.mjs';

const endpointModules = await importFolderDefaults(
	new URL('./endpoints/', import.meta.url),
);

/**
 * Mounted at the root, each folder's endpoint on a router of its own at the
 * route it had as an extension: its folder name, or the id it declares.
 */
export default {
	id: '',
	handler(router, context) {
		for (const { folderName, folderDefault } of endpointModules) {
			const folderRouter = Router();

			if (typeof folderDefault === 'function') {
				router.use(`/${folderName}`, folderRouter);
				folderDefault(folderRouter, context);
				continue;
			}

			router.use(`/${folderDefault.id}`, folderRouter);
			folderDefault.handler(folderRouter, context);
		}
	},
};
