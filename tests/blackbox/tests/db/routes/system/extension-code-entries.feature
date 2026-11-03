Feature: A bundle declaring its entries in code runs its migrations

  - A request authenticates as the admin.
  - `code-entries-probe` is a harness bundle loaded as a package dependency of
    the instance. Its `api.mjs` declares, in code, an endpoint and a
    before-schema migration creating `code_entries_probe`; its manifest lists
    no entries. The endpoint answers whether the table exists and the version
    `directus_migrations` holds for the migration.
  - The instance was bootstrapped, which runs the migrations of its bundles.

  Scenario: bootstrap runs the migration a bundle declares in code
    Then these requests get these responses:
      | request                   | response                                            |
      | method: GET               | code: 200                                           |+
      | path: /code-entries-probe | body:                                               |
      | eventually: true          |   data:                                             |
      |                           |     table_exists: true                              |
      |                           |     migration_version: code-entries-probe:20990101A |

  Scenario: app entries read from an app chunk the server no longer serves are refused
    Then these requests get these responses:
      | request                       | response                      |
      | method: POST                  | code: 409                     |+
      | path: /extensions/app-entries | body:                         |
      | payload:                      |   errors:                     |
      |   chunk: stale-chunk          |     - extensions:             |
      |   entries: []                 |         code: APP_CHUNK_STALE |
