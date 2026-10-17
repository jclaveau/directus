Feature: Extension settings rows are rewritten, toggled and removed

  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario. A response cell states the keys it checks.
  - `/extension-settings-probe` is a harness endpoint living in the folder of
    that name, while its package is named `extension-settings-probe-package`.
    It answers with its own settings row, plants a registry row for a folder
    no extension holds, and reads a planted row back, null once it is gone.
  - An extension update answers once the extensions are reloaded. A request
    marked `eventually` is sent again until its response matches, for up to
    ten seconds: the probe answers only once the extensions are loaded.

  Scenario: a settings row named after the package is taken back by the folder
    Given these requests are sent:
      | request                                      | response          |
      | method: GET                                  | code: 200         |+
      | path: /extension-settings-probe              | body:             |
      | remember: probe                              |   data:           |
      | eventually: true                             |                   |
      |                                              |     source: local |
      | method: PATCH                                | code: 200         |+
      | path: /extensions/<probe>                    | body:             |
      | payload:                                     |   data:           |
      |   meta:                                      |     id: <probe>   |
      |     folder: extension-settings-probe-package |     bundle: null  |
      |                                              |     schema: null  |
    Then these requests get these responses:
      | request                         | response                             |
      | method: GET                     | code: 200                            |+
      | path: /extension-settings-probe | body:                                |
      |                                 |   data:                              |
      |                                 |     id: <probe>                      |
      |                                 |     folder: extension-settings-probe |

  Scenario: a GraphQL update of an extension answers with its settings
    Given these requests are sent:
      | request                                       | response  |
      | method: POST                                  | code: 200 |+
      | path: /extension-settings-probe/registry-rows |           |
      | payload:                                      |           |
      |   folder: probe-graphql-<run>                 |           |
      | remember: registry_row                        |           |
      | eventually: true                              |           |
    Then these requests get these responses:
      | request                                          | response                    |
      | method: POST                                     | code: 200                   |+
      | path: /graphql/system                            | body:                       |
      | payload:                                         |   data:                     |
      |   query: >-                                      |     update_extensions_item: |
      |     mutation {                                   |       bundle: null          |
      |     update_extensions_item(id: "<registry_row>", |       meta:                 |
      |     data: { meta: { enabled: false } })          |         enabled: false      |
      |     { bundle meta { enabled } } }                |                             |

  Scenario: uninstalling a registry extension removes its settings row
    Given these requests are sent:
      | request                                       | response  |
      | method: POST                                  | code: 200 |+
      | path: /extension-settings-probe/registry-rows |           |
      | payload:                                      |           |
      |   folder: probe-uninstalled-<run>             |           |
      | remember: registry_row                        |           |
      | eventually: true                              |           |
    Then these requests get these responses:
      | request                                                      | response     |
      | method: DELETE                                               | code: 204    |+
      | path: /extensions/registry/uninstall/<registry_row>          |              |
      | method: GET                                                  | code: 200    |+
      | path: /extension-settings-probe/registry-rows/<registry_row> | body:        |
      | eventually: true                                             |   data: null |

  Scenario: deleting an extension by its key removes its settings row
    Given these requests are sent:
      | request                                       | response  |
      | method: POST                                  | code: 200 |+
      | path: /extension-settings-probe/registry-rows |           |
      | payload:                                      |           |
      |   folder: probe-deleted-<run>                 |           |
      | remember: registry_row                        |           |
      | eventually: true                              |           |
    Then these requests get these responses:
      | request                                                      | response     |
      | method: DELETE                                               | code: 204    |+
      | path: /extensions/<registry_row>                             |              |
      | method: GET                                                  | code: 200    |+
      | path: /extension-settings-probe/registry-rows/<registry_row> | body:        |
      | eventually: true                                             |   data: null |

  Scenario: an endpoint answers as its extension was just toggled
    Given these requests are sent:
      | request                         | response          |
      | method: GET                     | code: 200         |+
      | path: /extension-settings-probe | body:             |
      | remember: probe                 |   data:           |
      | eventually: true                |                   |
      |                                 |     source: local |
    Then these requests get these responses:
      | request                         | response                          |
      | method: PATCH                   | code: 200                         |+
      | path: /extensions/<probe>       | body:                             |
      | payload:                        |   data:                           |
      |   meta:                         |     meta:                         |
      |     enabled: false              |       enabled: false              |
      | method: GET                     | code: 404                         |+
      | path: /extension-settings-probe | body:                             |
      |                                 |   errors:                         |
      |                                 |     - message: >-                 |
      |                                 |         Route                     |
      |                                 |         /extension-settings-probe |
      |                                 |         doesn't exist.            |
      | method: PATCH                   | code: 200                         |+
      | path: /extensions/<probe>       | body:                             |
      | payload:                        |   data:                           |
      |   meta:                         |     meta:                         |
      |     enabled: true               |       enabled: true               |
      | method: GET                     | code: 200                         |+
      | path: /extension-settings-probe | body:                             |
      |                                 |   data:                           |
      |                                 |     id: <probe>                   |
