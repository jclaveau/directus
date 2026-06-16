import { NameDeduper } from "./assets/name-deduper.js";
import { validateAccess } from "../permissions/modules/validate-access/validate-access.js";
import { ItemsService } from "./items.js";

//#region src/services/folders.ts
var FoldersService = class extends ItemsService {
	constructor(options) {
		super("directus_folders", options);
	}
	/**
	* Builds a full folder tree starting from a given root folder.
	*
	* This method returns a map of folder IDs to their corresponding paths
	* relative to the root. It resolves all nested child folders and ensures
	* that folder names are deduplicated within the same parent.
	*
	* Access control is applied automatically when non-admin, only folders the user has `read`
	* access to are included.
	*
	* @param {string} root - The ID of the root folder to start building the tree from.
	* @returns {Promise<Map<string, string>>} A `Map` where:
	*   - Key: folder ID
	*   - Value: folder path relative to the root (e.g., "Documents/Photos")
	*
	* @example
	* const foldersService = new FoldersService({ schema, accountability });
	* const tree = await foldersService.buildTree('root-folder-id');
	* console.log(tree.get('folder1')); // e.g., "RootFolder/SubFolder1"
	*
	* @remarks
	* - The returned `Map` includes the root folder itself.
	* - If a folder has no name, its ID will be used as a fallback.
	*/
	async buildTree(root) {
		if (this.accountability && this.accountability.admin !== true) await validateAccess({
			collection: "directus_folders",
			accountability: this.accountability,
			action: "read",
			primaryKeys: [root]
		}, {
			knex: this.knex,
			schema: this.schema
		});
		const folders = await this.readByQuery({ limit: -1 });
		const folderLookup = /* @__PURE__ */ new Map();
		const childFolderLookup = /* @__PURE__ */ new Map();
		for (const folder of folders) {
			if (!folder["id"]) continue;
			folderLookup.set(folder["id"], folder);
			if (folder["parent"] && folder["id"] !== root) {
				const children = childFolderLookup.get(folder["parent"]) ?? [];
				children.push(folder["id"]);
				childFolderLookup.set(folder["parent"], children);
			}
		}
		const deduper = new NameDeduper();
		const rootName = deduper.add(folderLookup.get(root)?.name, { fallback: root });
		const stack = [[root, ""]];
		const tree = /* @__PURE__ */ new Map();
		while (stack.length > 0) {
			const [folderId, path] = stack.pop() ?? [];
			if (!folderId) continue;
			const folder = folderLookup.get(folderId);
			if (!folder) continue;
			const children = childFolderLookup.get(folderId);
			const folderName = deduper.add(folder["name"], {
				group: folder["parent"],
				fallback: folderId
			});
			const folderPath = path === "" ? rootName : `${path}/${folderName}`;
			tree.set(folderId, folderPath);
			for (const childFolderId of children ?? []) stack.push([childFolderId, folderPath]);
		}
		return tree;
	}
};

//#endregion
export { FoldersService };