Feature: A file's disk name is held by one file, whichever way it is written

  - A request authenticates as the admin, or with the token its `as` cell
    holds. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own, or for the key a `remember: name` row
    stored. A response cell states the keys it checks.
  - A file whose description reads `claim-disk-name:<name>` has its disk name
    rewritten to `<name>` by a filter hook (files-disk-name-claim).

  Scenario: a disk name a filter hook claims is refused when another file holds it
    Given these requests are sent:
      | request                              | response  |
      | method: POST                         | code: 200 |+
      | path: /files                         |           |
      | payload:                             |           |
      |   type: text/plain                   |           |
      |   storage: local                     |           |
      |   filename_download: held-<run>.txt  |           |
      |   filename_disk: held-<run>.txt      |           |
      | method: POST                         | code: 200 |+
      | path: /files                         |           |
      | payload:                             |           |
      |   type: text/plain                   |           |
      |   storage: local                     |           |
      |   filename_download: other-<run>.txt |           |
      |   filename_disk: other-<run>.txt     |           |
      | remember: other                      |           |
    Then these requests get these responses:
      | request                              | response                            |
      | method: POST                         | code: 400                           |+
      | path: /files                         | body:                               |
      | payload:                             |   errors:                           |
      |   type: text/plain                   |     - message: >-                   |
      |   storage: local                     |         Invalid payload.            |
      |   filename_download: claim-<run>.txt |         "filename_disk"             |
      |   description: >-                    |         "held-<run>.txt" is already |
      |     claim-disk-name:held-<run>.txt   |         used by another file.       |
      | method: PATCH                        | code: 400                           |+
      | path: /files/<other>                 | body:                               |
      | payload:                             |   errors:                           |
      |   description: >-                    |     - message: >-                   |
      |     claim-disk-name:held-<run>.txt   |         Invalid payload.            |
      |                                      |         "filename_disk"             |
      |                                      |         "held-<run>.txt" is already |
      |                                      |         used by another file.       |
      | method: GET                          | code: 200                           |+
      | path: /files                         | body:                               |
      | query:                               |   data: []                          |
      |   fields: id                         |                                     |
      |   filter[filename_download][_eq]: >- |                                     |
      |     claim-<run>.txt                  |                                     |
      | method: GET                          | code: 200                           |+
      | path: /files/<other>                 | body:                               |
      | query:                               |   data:                             |
      |   fields: filename_disk              |     filename_disk: other-<run>.txt  |

  Scenario: a disk name that is not a normalised relative path is refused
    Given these requests are sent:
      | request                              | response  |
      | method: POST                         | code: 200 |+
      | path: /files                         |           |
      | payload:                             |           |
      |   type: text/plain                   |           |
      |   storage: local                     |           |
      |   filename_download: other-<run>.txt |           |
      |   filename_disk: other-<run>.txt     |           |
      | remember: other                      |           |
    Then these requests get these responses:
      | request                                  | response                             |
      | method: POST                             | code: 400                            |+
      | path: /files                             | body:                                |
      | payload:                                 |   errors:                            |
      |   type: text/plain                       |     - message: >-                    |
      |   storage: local                         |         Invalid payload.             |
      |   filename_download: rooted-<run>.txt    |         "filename_disk"              |
      |   filename_disk: /rooted-<run>.txt       |         "/rooted-<run>.txt" must be  |
      |                                          |         a relative path without      |
      |                                          |         empty, "." or ".." segments. |
      | method: PATCH                            | code: 400                            |+
      | path: /files/<other>                     | body:                                |
      | payload:                                 |   errors:                            |
      |   filename_disk: ./dotted-<run>.txt      |     - message: >-                    |
      |                                          |         Invalid payload.             |
      |                                          |         "filename_disk"              |
      |                                          |         "./dotted-<run>.txt" must be |
      |                                          |         a relative path without      |
      |                                          |         empty, "." or ".." segments. |
      | method: POST                             | code: 400                            |+
      | path: /files/tus                         | text: >-                             |
      | headers:                                 |   "filename_disk"                    |
      |   Tus-Resumable: 1.0.0                   |   "up/../climbed-<run>.txt" must be  |
      |   Upload-Length: '4'                     |   a relative path without empty, "." |
      | upload_metadata:                         |   or ".." segments                   |
      |   filename_download: climbed-<run>.txt   |                                      |
      |   filename_disk: up/../climbed-<run>.txt |                                      |
      | method: GET                              | code: 200                            |+
      | path: /files                             | body:                                |
      | query:                                   |   data: []                           |
      |   fields: id                             |                                      |
      |   filter[filename_download][_eq]: >-     |                                      |
      |     rooted-<run>.txt                     |                                      |
      | method: GET                              | code: 200                            |+
      | path: /files/<other>                     | body:                                |
      | query:                                   |   data:                              |
      |   fields: filename_disk                  |     filename_disk: other-<run>.txt   |

  Scenario: an upload that fails to start leaves neither its row nor its file behind
    Given these requests are sent:
      | request                            | response  |
      | method: POST                       | code: 200 |+
      | path: /policies                    |           |
      | payload:                           |           |
      |   id: <creator-policy>             |           |
      |   name: creator-<run>              |           |
      |   app_access: false                |           |
      |   admin_access: false              |           |
      |   permissions:                     |           |
      |     - collection: directus_files   |           |
      |       action: create               |           |
      |       fields:                      |           |
      |         - '*'                      |           |
      | method: POST                       | code: 200 |+
      | path: /users                       |           |
      | payload:                           |           |
      |   email: creator-<run>@example.com |           |
      |   token: <creator-token>           |           |
      |   policies:                        |           |
      |     - policy: <creator-policy>     |           |
    Then these requests get these responses:
      | request                               | response  |
      | as: <creator-token>                   | code: 500 |+
      | method: POST                          |           |
      | path: /files/tus                      |           |
      | headers:                              |           |
      |   Tus-Resumable: 1.0.0                |           |
      |   Upload-Length: '4'                  |           |
      | upload_metadata:                      |           |
      |   filename_download: rolled-<run>.txt |           |
      |   filename_disk: rolled-<run>.txt     |           |
      | as: <creator-token>                   | code: 500 |+
      | method: POST                          |           |
      | path: /files/tus                      |           |
      | headers:                              |           |
      |   Tus-Resumable: 1.0.0                |           |
      |   Upload-Length: '4'                  |           |
      | upload_metadata:                      |           |
      |   filename_download: rolled-<run>.txt |           |
      |   filename_disk: rolled-<run>.txt     |           |
      | method: POST                          | code: 201 |+
      | path: /files/tus                      |           |
      | headers:                              |           |
      |   Tus-Resumable: 1.0.0                |           |
      |   Upload-Length: '4'                  |           |
      | upload_metadata:                      |           |
      |   filename_download: rolled-<run>.txt |           |
      |   filename_disk: rolled-<run>.txt     |           |

  Scenario: an upload naming the disk name a row holds without its bytes is refused
    Given these requests are sent:
      | request                             | response  |
      | method: POST                        | code: 200 |+
      | path: /files                        |           |
      | payload:                            |           |
      |   type: text/plain                  |           |
      |   storage: local                    |           |
      |   filename_download: held-<run>.txt |           |
      |   filename_disk: held-<run>.txt     |           |
    Then these requests get these responses:
      | request                             | response                           |
      | method: POST                        | code: 400                          |+
      | path: /files/tus                    | text: >-                           |
      | headers:                            |   "filename_disk" "held-<run>.txt" |
      |   Tus-Resumable: 1.0.0              |   is already used                  |
      |   Upload-Length: '4'                |                                    |
      | upload_metadata:                    |                                    |
      |   filename_download: lost-<run>.txt |                                    |
      |   filename_disk: held-<run>.txt     |                                    |

  Scenario: a disk name a permission preset claims is refused when another file holds it
    Given these requests are sent:
      | request                               | response  |
      | method: POST                          | code: 200 |+
      | path: /files                          |           |
      | payload:                              |           |
      |   type: text/plain                    |           |
      |   storage: local                      |           |
      |   filename_download: held-<run>.txt   |           |
      |   filename_disk: held-<run>.txt       |           |
      | method: POST                          | code: 200 |+
      | path: /policies                       |           |
      | payload:                              |           |
      |   id: <preset-policy>                 |           |
      |   name: preset-<run>                  |           |
      |   app_access: false                   |           |
      |   admin_access: false                 |           |
      |   permissions:                        |           |
      |     - collection: directus_files      |           |
      |       action: create                  |           |
      |       fields:                         |           |
      |         - '*'                         |           |
      |       presets:                        |           |
      |         filename_disk: held-<run>.txt |           |
      | method: POST                          | code: 200 |+
      | path: /users                          |           |
      | payload:                              |           |
      |   email: preset-<run>@example.com     |           |
      |   token: <preset-token>               |           |
      |   policies:                           |           |
      |     - policy: <preset-policy>         |           |
    Then these requests get these responses:
      | request                               | response                            |
      | as: <preset-token>                    | code: 400                           |+
      | method: POST                          | body:                               |
      | path: /files                          |   errors:                           |
      | payload:                              |     - message: >-                   |
      |   type: text/plain                    |         Invalid payload.            |
      |   storage: local                      |         "filename_disk"             |
      |   filename_download: preset-<run>.txt |         "held-<run>.txt" is already |
      |                                       |         used by another file.       |
      | method: GET                           | code: 200                           |+
      | path: /files                          | body:                               |
      | query:                                |   data: []                          |
      |   fields: id                          |                                     |
      |   filter[filename_download][_eq]: >-  |                                     |
      |     preset-<run>.txt                  |                                     |

  Scenario: a disk name is judged once per file a batch writes, and not for no file
    Given these requests are sent:
      | request                              | response  |
      | method: POST                         | code: 200 |+
      | path: /files                         |           |
      | payload:                             |           |
      |   type: text/plain                   |           |
      |   storage: local                     |           |
      |   filename_download: held-<run>.txt  |           |
      |   filename_disk: held-<run>.txt      |           |
      | method: POST                         | code: 200 |+
      | path: /files                         |           |
      | payload:                             |           |
      |   type: text/plain                   |           |
      |   storage: local                     |           |
      |   filename_download: other-<run>.txt |           |
      |   filename_disk: other-<run>.txt     |           |
      | remember: other                      |           |
    Then these requests get these responses:
      | request                              | response                             |
      | method: PATCH                        | code: 200                            |+
      | path: /files                         |                                      |
      | payload:                             |                                      |
      |   keys:                              |                                      |
      |     - <other>                        |                                      |
      |     - <other>                        |                                      |
      |   data:                              |                                      |
      |     filename_disk: renamed-<run>.txt |                                      |
      | method: GET                          | code: 200                            |+
      | path: /files/<other>                 | body:                                |
      | query:                               |   data:                              |
      |   fields: filename_disk              |     filename_disk: renamed-<run>.txt |
      | method: PATCH                        | code: 200                            |+
      | path: /files                         | body:                                |
      | payload:                             |   data: []                           |
      |   query:                             |                                      |
      |     filter:                          |                                      |
      |       filename_download:             |                                      |
      |         _eq: nothing-<run>.txt       |                                      |
      |   data:                              |                                      |
      |     filename_disk: held-<run>.txt    |                                      |
