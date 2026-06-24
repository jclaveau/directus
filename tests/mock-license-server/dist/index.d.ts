import { License, LicenseAddon } from "@directus/license";
import Type from "typebox";
import { DeepPartial } from "@directus/types";

//#region src/types.d.ts

type MockLicense = {
  name: string;
  key: string;
  entitlements: License['entitlements'];
  meta: License['meta'];
  max_projects: number;
  projects: {
    id: string;
    url: string;
  }[];
  /** Available Addons */
  addons: (LicenseAddon & {
    unit: 'seats' | 'collections' | 'flows';
  })[];
};
//#endregion
//#region src/utils.d.ts
declare function generateKey(): string;
declare function createLicense(overrides?: DeepPartial<MockLicense>): MockLicense;
//#endregion
//#region src/app.d.ts
declare const startServer: () => Promise<void>;
declare namespace client_d_exports {
  export { activateKey, registerLicense };
}
declare function registerLicense(base: string, license: MockLicense): Promise<void>;
declare function activateKey(base: string, body: {
  license_key: string;
  project_id: string;
  public_url: string;
}): Promise<{
  token: string;
  new_project_id?: string;
}>;
//#endregion
export { type MockLicense, createLicense, generateKey, client_d_exports as mockClient, startServer };