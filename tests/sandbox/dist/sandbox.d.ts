import { Env } from "./config.js";
import { Logger } from "./logger.js";
import { Port, PortRange } from "./port.js";
import { Api } from "./steps/api.js";
import "./steps/index.js";
import { Knex } from "knex";
import { DatabaseClient, DeepPartial } from "@directus/types";

//#region src/sandbox.d.ts
type Database = Exclude<DatabaseClient, 'redshift'> | 'maria';
type Options = {
  /** Rebuild directus from source */
  build: boolean;
  /** Start directus in developer mode. Not compatible with build */
  dev: boolean;
  /** Restart the api when changes are made */
  watch: boolean;
  /** Port to start the api on */
  port: Port | undefined;
  /** Spin up the app in dev mode */
  app: boolean | Port;
  /** Which version of the database to use */
  dbVersion: string | undefined;
  /** Configure the behavior of the spun up docker container */
  docker: {
    /** Keep containers running when stopping the sandbox */
    keep: boolean;
    /** Minimum port number to use for docker containers */
    port: Port | PortRange | undefined;
    /** Overwrite the name of the docker project */
    name: string | undefined;
    /** Adds a suffix to the docker project. Can be used to ensure uniqueness */
    suffix: string;
  };
  /** Horizontally scale the api to a given number of instances */
  instances: string;
  /** Add environment variables that the api should start with */
  env: Record<string, string>;
  /** Prefix the logs, useful when starting multiple sandboxes */
  prefix: string | undefined;
  /** Exports a snapshot and type definition every 2 seconds */
  export: boolean;
  /** Silence all logs except for errors */
  silent: boolean;
  /** Load an additional schema snapshot on startup */
  schema: string | undefined;
  /** Start the api with debugger */
  inspect: boolean;
  /** Enable redis,maildev,saml or other extras */
  extras: {
    /** Used for caching, forced to true if instances > 1 */
    redis: boolean;
    /** Auth provider */
    saml: boolean;
    /** Storage provider */
    minio: boolean;
    /** Email server */
    maildev: boolean;
    /** License server */
    license: boolean;
  };
  /** Enable or disable caching */
  cache: boolean;
  /** Skips setting initial admin and owner */
  skipSetup: boolean;
  /** Open a Knex connection for direct db access via `sandbox.knex`. Off by default.  */
  knex: boolean;
  /** Lifecycle hooks */
  hooks: {
    /** Runs after bootstrap (+ load schema) but before the api starts */
    beforeApi?: (ctx: {
      env: Env;
      logger: Logger;
      knex?: Knex | undefined;
    }) => Promise<void> | void;
  };
};
type Sandboxes = {
  sandboxes: {
    apis: [Api, ...Api[]];
    env: Env;
    logger: Logger;
    knex?: Knex | undefined;
  }[];
  restartApis(): Promise<void>;
  stop(): Promise<void>;
};
type Sandbox = {
  restartApi(): Promise<void>;
  stop(): Promise<void>;
  env: Env;
  apis: [Api, ...Api[]];
  logger: Logger;
  knex?: Knex | undefined;
};
declare const apiFolder: string;
declare const appFolder: string;
declare const licenseFolder: string;
declare const databases: Database[];
type SandboxesOptions = {
  database: Database;
  options: DeepPartial<Omit<Options, 'build' | 'dev' | 'watch' | 'export'>>;
}[];
declare function sandboxes(sandboxOptions: SandboxesOptions, options?: Partial<Pick<Options, 'build' | 'dev' | 'watch'>>): Promise<Sandboxes>;
declare function sandbox(database: Database, options?: DeepPartial<Options>): Promise<Sandbox>;
//#endregion
export { Database, Options, Sandbox, Sandboxes, SandboxesOptions, apiFolder, appFolder, databases, licenseFolder, sandbox, sandboxes };