import type { PackageVersion } from '../types';
export declare function processPackages(): Promise<{
    mainVersion: string | undefined;
    packageVersions: PackageVersion[];
}>;
