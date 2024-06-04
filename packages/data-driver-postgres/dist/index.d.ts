import { DataDriver, AbstractQuery } from '@directus/data';
import { Readable } from 'node:stream';

/**
 * The driver for PostgreSQL which can be registered by using @directus/data.
 *
 *  @packageDocumentation
 */

interface DataDriverPostgresConfig {
    connectionString: string;
}
declare class DataDriverPostgres implements DataDriver {
    #private;
    constructor(config: DataDriverPostgresConfig);
    destroy(): Promise<void>;
    query(query: AbstractQuery): Promise<Readable>;
}

export { DataDriverPostgresConfig, DataDriverPostgres as default };
