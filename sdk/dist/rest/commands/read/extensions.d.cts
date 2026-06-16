import { DirectusExtension, ExtensionTypes } from "../../../schema/extension.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/read/extensions.d.ts
type DirectusExtensionRegistryPublisher = {
  username: string;
  verified: boolean;
  github_name: string | null;
};
type DirectusExtensionRegistry = {
  id: string;
  name: string;
  description: string | null;
  total_downloads: number;
  verified: boolean;
  type: ExtensionTypes;
  last_updated: string;
  host_version: string;
  sandbox: boolean;
  license: string | null;
  publisher: DirectusExtensionRegistryPublisher;
};
type DirectusExtensionRegistryAccount = {
  id: string;
  username: string;
  verified: boolean;
  github_username: string | null;
  github_avatar_url: string | null;
  github_name: string | null;
  github_company: string | null;
  github_blog: string | null;
  github_location: string | null;
  github_bio: string | null;
};
type DirectusExtensionRegistryVersionPublisher = {
  id: string;
  username: string;
  verified: boolean;
  github_name: string | null;
  github_avatar_url: string | null;
};
type DirectusExtensionRegistryVersion = {
  id: string;
  version: string;
  verified: boolean;
  type: ExtensionTypes;
  host_version: string;
  publish_date: string;
  unpacked_size: number;
  file_count: number;
  url_bugs: string | null;
  url_homepage: string | null;
  url_repository: string | null;
  license: string | null;
  publisher: DirectusExtensionRegistryVersionPublisher;
  bundled: {
    name: string;
    type: string;
  }[];
  maintainers: {
    accounts_id: DirectusExtensionRegistryVersionPublisher;
  }[] | null;
};
type DirectusExtensionRegistryDetail = {
  id: string;
  name: string;
  description: string | null;
  total_downloads: number;
  downloads: {
    date: string;
    count: number;
  }[] | null;
  verified: boolean;
  readme: string | null;
  type: ExtensionTypes;
  license: string | null;
  versions: DirectusExtensionRegistryVersion[];
};
type DirectusExtensionRegistryQuery = {
  search?: string;
  limit?: number;
  offset?: number;
  sort?: "popular" | "recent" | "downloads";
  filter?: {
    by?: {
      _eq: string;
    };
    type?: {
      _eq: ExtensionTypes;
    };
  };
};
/**
* List the available extensions in the project.
* @returns An array of extensions.
*/
declare const readExtensions: <Schema>() => RestCommand<DirectusExtension<Schema>[], Schema>;
/**
* List extensions available in the registry.
* @param query - Optional query parameters (search, limit, offset, sort, filter)
* @returns Array of registry extensions.
*/
declare const readRegistryExtensions: <Schema>(query?: DirectusExtensionRegistryQuery) => RestCommand<DirectusExtensionRegistry[], Schema>;
/**
* Fetch a publisher account from the registry.
* @param pk - Publisher account UUID
* @returns The publisher account.
* @throws Will throw if pk is empty
*/
declare const readRegistryAccount: <Schema>(pk: string) => RestCommand<DirectusExtensionRegistryAccount, Schema>;
/**
* Read a single extension from the registry.
* @param pk - Registry extension UUID
* @returns The registry extension.
* @throws Will throw if pk is empty
*/
declare const readRegistryExtension: <Schema>(pk: string) => RestCommand<DirectusExtensionRegistryDetail, Schema>;
//#endregion
export { DirectusExtensionRegistry, DirectusExtensionRegistryAccount, DirectusExtensionRegistryDetail, DirectusExtensionRegistryPublisher, DirectusExtensionRegistryQuery, DirectusExtensionRegistryVersion, DirectusExtensionRegistryVersionPublisher, readExtensions, readRegistryAccount, readRegistryExtension, readRegistryExtensions };
//# sourceMappingURL=extensions.d.cts.map