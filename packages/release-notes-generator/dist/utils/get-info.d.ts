import type { Changesets, Notice, Type, UntypedPackage } from '../types';
export declare function getInfo(changesets: Changesets): Promise<{
    types: Type[];
    untypedPackages: UntypedPackage[];
    notices: Notice[];
}>;
