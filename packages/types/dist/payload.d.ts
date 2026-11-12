import type { ActionEventParams, Item, PrimaryKey } from './items.js';
import type { UserIntegrityCheckFlag } from './users.js';
export type PayloadAction = 'create' | 'read' | 'update';
export type PayloadServiceProcessRelationResult = {
    revisions: PrimaryKey[];
    nestedActionEvents: ActionEventParams[];
    userIntegrityCheckFlags: UserIntegrityCheckFlag;
};
export type PayloadServiceProcessO2MResult = Omit<PayloadServiceProcessRelationResult, 'revisions'> & {
    /** The revisions written for each parent row, in the order of the rows */
    revisionsByParent: PrimaryKey[][];
};
export type PayloadServiceProcessRowsResult = PayloadServiceProcessO2MResult & {
    /** Each row's payload, its nested records replaced by their keys */
    payloads: Partial<Item>[];
};
