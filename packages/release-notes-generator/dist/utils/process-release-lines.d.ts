import type { ChangelogFunctions } from '@changesets/types';
import type { Changesets } from '../types';
export declare function processReleaseLines(): {
    defaultChangelogFunctions: ChangelogFunctions;
    changesets: Changesets;
};
