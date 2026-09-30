import type { PackageVersion } from '../types.js';
export declare function processPackages(): Promise<{
    mainVersion: string;
    isPrerelease: boolean;
    prereleaseId: string | undefined;
    packageVersions: PackageVersion[];
}>;
