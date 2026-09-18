import type { Changesets, Notice, Type, UntypedPackage } from '../types.js';
export declare function getInfo(changesets: Changesets): Promise<{
    types: Type[];
    untypedPackages: UntypedPackage[];
    notices: Notice[];
}>;
