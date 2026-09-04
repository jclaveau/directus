export type MSSQLError = {
	message: string;
	code: 'EREQUEST';
	number: number;
	state: number;
	class: number;
	serverName: string;
	procName: string;
	lineNumber: number;
};

export type MySQLError = {
	message: string;
	code: string;
	errno: number;
	sqlMessage: string;
	sqlState: string;
	index: number;
	sql: string;
};

export type PostgresError = {
	message: string;
	length: number;
	code: string;
	detail: string;
	schema: string;
	table: string;
	// pg sets these on every error and leaves them undefined when it names no
	// column, type or constraint — the key is always there.
	column: string | undefined;
	dataType: string | undefined;
	constraint: string | undefined;
};

export type OracleError = {
	message: string;
	errorNum: number;
	offset: number;
};

export type SQLiteError = {
	message: string;
	errno: number;
	code: string;
};

export type SQLError = MSSQLError & MySQLError & PostgresError & SQLiteError & OracleError & Error;

// Call-site context a driver error can't carry: the collection the caller operated
// on (the driver reports the child on a delete/RESTRICT, not the acted-on parent)
// and which operation it was (to name delete vs update in the message).
export interface DatabaseErrorContext {
	collection?: string;
	operation?: 'create' | 'update' | 'delete';
}
