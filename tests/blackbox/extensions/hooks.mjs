import { importFolderDefaults } from './folder-defaults.mjs';

const hookModules = await importFolderDefaults(
	new URL('./hooks/', import.meta.url),
);

export default (register, context) => {
	for (const { folderDefault } of hookModules) {
		folderDefault(register, context);
	}
};
