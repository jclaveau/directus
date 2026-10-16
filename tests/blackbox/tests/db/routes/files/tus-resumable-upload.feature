Feature: A file is uploaded, replaced and terminated through tus

  - The feature runs against an instance of its own started with
    `TUS_ENABLED=true`: a file still uploading is left out of `/files`.
  - A request cell is YAML: `upload_metadata` is sent as the tus
    `Upload-Metadata` header, each value base64; `body` is sent raw;
    `remember_headers` keeps the last path segment of a response header,
    so `Location` names the upload.
  - A request authenticates as the admin. `<run>` stands for a value unique
    to the scenario, and any other `<name>` for a uuid of its own or the key
    a row remembered. A response cell states the keys it checks.

  Scenario: an upload sent in two chunks becomes a file once its last byte lands
    Then these requests get these responses:
      | request                                | response               |
      | method: POST                           | code: 201              |+
      | path: /files/tus                       |                        |
      | headers:                               |                        |
      |   Tus-Resumable: 1.0.0                 |                        |
      |   Upload-Length: '11'                  |                        |
      | upload_metadata:                       |                        |
      |   filename_download: chunked-<run>.txt |                        |
      |   type: text/plain                     |                        |
      | remember_headers:                      |                        |
      |   upload: Location                     |                        |
      |   file: Directus-File-Id               |                        |
      | method: PATCH                          | code: 204              |+
      | path: /files/tus/<upload>              | headers:               |
      | headers:                               |   Upload-Offset: '6'   |
      |   Tus-Resumable: 1.0.0                 |                        |
      |   Upload-Offset: '0'                   |                        |
      |   Content-Type: >-                     |                        |
      |     application/offset+octet-stream    |                        |
      | body: 'hello '                         |                        |
      | method: HEAD                           | code: 200              |+
      | path: /files/tus/<upload>              | headers:               |
      | headers:                               |   Upload-Offset: '6'   |
      |   Tus-Resumable: 1.0.0                 |   Upload-Length: '11'  |
      | method: GET                            | code: 200              |+
      | path: /files                           | body:                  |
      | query:                                 |   data: []             |
      |   fields: id                           |                        |
      |   filter[filename_download][_eq]: >-   |                        |
      |     chunked-<run>.txt                  |                        |
      | method: PATCH                          | code: 204              |+
      | path: /files/tus/<upload>              | headers:               |
      | headers:                               |   Upload-Offset: '11'  |
      |   Tus-Resumable: 1.0.0                 |                        |
      |   Upload-Offset: '6'                   |                        |
      |   Content-Type: >-                     |                        |
      |     application/offset+octet-stream    |                        |
      | body: world                            |                        |
      | method: GET                            | code: 200              |+
      | path: /files                           | body:                  |
      | query:                                 |   data:                |
      |   fields: id,type,tus_id               |     - id: <file>       |
      |   filter[filename_download][_eq]: >-   |       type: text/plain |
      |     chunked-<run>.txt                  |       tus_id: null     |
      |   filter[filesize][_eq]: '11'          |                        |
      | method: GET                            | code: 200              |+
      | path: /assets/<file>                   | text: hello world      |
      | method: HEAD                           | code: 404              |+
      | path: /files/tus/<upload>              |                        |
      | headers:                               |                        |
      |   Tus-Resumable: 1.0.0                 |                        |

  Scenario: an upload naming an existing file replaces its content and its name
    Given these requests are sent:
      | request                              | response  |
      | method: POST                         | code: 201 |+
      | path: /files/tus                     |           |
      | headers:                             |           |
      |   Tus-Resumable: 1.0.0               |           |
      |   Upload-Length: '5'                 |           |
      | upload_metadata:                     |           |
      |   filename_download: first-<run>.txt |           |
      |   type: text/plain                   |           |
      | remember_headers:                    |           |
      |   first-upload: Location             |           |
      |   file: Directus-File-Id             |           |
      | method: PATCH                        | code: 204 |+
      | path: /files/tus/<first-upload>      |           |
      | headers:                             |           |
      |   Tus-Resumable: 1.0.0               |           |
      |   Upload-Offset: '0'                 |           |
      |   Content-Type: >-                   |           |
      |     application/offset+octet-stream  |           |
      | body: first                          |           |
    Then these requests get these responses:
      | request                               | response                   |
      | method: POST                          | code: 201                  |+
      | path: /files/tus                      | headers:                   |
      | headers:                              |   Directus-File-Id: <file> |
      |   Tus-Resumable: 1.0.0                |                            |
      |   Upload-Length: '6'                  |                            |
      | upload_metadata:                      |                            |
      |   id: <file>                          |                            |
      |   filename_download: second-<run>.txt |                            |
      |   type: text/plain                    |                            |
      | remember_headers:                     |                            |
      |   second-upload: Location             |                            |
      | method: PATCH                         | code: 204                  |+
      | path: /files/tus/<second-upload>      |                            |
      | headers:                              |                            |
      |   Tus-Resumable: 1.0.0                |                            |
      |   Upload-Offset: '0'                  |                            |
      |   Content-Type: >-                    |                            |
      |     application/offset+octet-stream   |                            |
      | body: second                          |                            |
      | method: GET                           | code: 200                  |+
      | path: /files/<file>                   | body:                      |
      | query:                                |   data:                    |
      |   fields: filename_download,tus_id    |     filename_download: >-  |
      |                                       |       second-<run>.txt     |
      |                                       |     tus_id: null           |
      | method: GET                           | code: 200                  |+
      | path: /files                          | body:                      |
      | query:                                |   data:                    |
      |   fields: id                          |     - id: <file>           |
      |   filter[filesize][_eq]: '6'          |                            |
      |   filter[filename_download][_eq]: >-  |                            |
      |     second-<run>.txt                  |                            |
      | method: GET                           | code: 200                  |+
      | path: /assets/<file>                  | text: second               |
      | method: HEAD                          | code: 404                  |+
      | path: /files/tus/<second-upload>      |                            |
      | headers:                              |                            |
      |   Tus-Resumable: 1.0.0                |                            |

  Scenario: a terminated upload leaves no file behind
    Then these requests get these responses:
      | request                                | response  |
      | method: POST                           | code: 201 |+
      | path: /files/tus                       |           |
      | headers:                               |           |
      |   Tus-Resumable: 1.0.0                 |           |
      |   Upload-Length: '8'                   |           |
      | upload_metadata:                       |           |
      |   filename_download: dropped-<run>.txt |           |
      | remember_headers:                      |           |
      |   upload: Location                     |           |
      | method: PATCH                          | code: 204 |+
      | path: /files/tus/<upload>              |           |
      | headers:                               |           |
      |   Tus-Resumable: 1.0.0                 |           |
      |   Upload-Offset: '0'                   |           |
      |   Content-Type: >-                     |           |
      |     application/offset+octet-stream    |           |
      | body: half                             |           |
      | method: DELETE                         | code: 204 |+
      | path: /files/tus/<upload>              |           |
      | headers:                               |           |
      |   Tus-Resumable: 1.0.0                 |           |
      | method: HEAD                           | code: 404 |+
      | path: /files/tus/<upload>              |           |
      | headers:                               |           |
      |   Tus-Resumable: 1.0.0                 |           |

  Scenario: an upload whose disk name names a directory is refused
    Given these requests are sent:
      | request                             | response  |
      | method: POST                        | code: 201 |+
      | path: /files/tus                    |           |
      | headers:                            |           |
      |   Tus-Resumable: 1.0.0              |           |
      |   Upload-Length: '4'                |           |
      | upload_metadata:                    |           |
      |   filename_download: kept-<run>.txt |           |
      |   type: text/plain                  |           |
      | remember_headers:                   |           |
      |   kept-upload: Location             |           |
      |   file: Directus-File-Id            |           |
      | method: PATCH                       | code: 204 |+
      | path: /files/tus/<kept-upload>      |           |
      | headers:                            |           |
      |   Tus-Resumable: 1.0.0              |           |
      |   Upload-Offset: '0'                |           |
      |   Content-Type: >-                  |           |
      |     application/offset+octet-stream |           |
      | body: kept                          |           |
    Then these requests get these responses:
      | request                              | response                    |
      | method: POST                         | code: 400                   |+
      | path: /files/tus                     | text: >-                    |
      | headers:                             |   "filename_disk" must name |
      |   Tus-Resumable: 1.0.0               |   a file, not a directory   |
      |   Upload-Length: '4'                 |                             |
      | upload_metadata:                     |                             |
      |   filename_download: lost-<run>.txt  |                             |
      |   filename_disk: /                   |                             |
      | method: POST                         | code: 400                   |+
      | path: /files/tus                     | text: >-                    |
      | headers:                             |   "filename_disk" must name |
      |   Tus-Resumable: 1.0.0               |   a file, not a directory   |
      |   Upload-Length: '4'                 |                             |
      | upload_metadata:                     |                             |
      |   id: <file>                         |                             |
      |   filename_download: lost-<run>.txt  |                             |
      |   filename_disk: /                   |                             |
      | method: GET                          | code: 200                   |+
      | path: /files                         | body:                       |
      | query:                               |   data: []                  |
      |   fields: id                         |                             |
      |   filter[filename_download][_eq]: >- |                             |
      |     lost-<run>.txt                   |                             |
      | method: GET                          | code: 200                   |+
      | path: /files/<file>                  | body:                       |
      | query:                               |   data:                     |
      |   fields: filename_download          |     filename_download: >-   |
      |                                      |       kept-<run>.txt        |
      | method: GET                          | code: 200                   |+
      | path: /assets/<file>                 | text: kept                  |

  Scenario: a replacement that cannot start leaves no row behind
    Given these requests are sent:
      | request                             | response  |
      | method: POST                        | code: 201 |+
      | path: /files/tus                    |           |
      | headers:                            |           |
      |   Tus-Resumable: 1.0.0              |           |
      |   Upload-Length: '4'                |           |
      | upload_metadata:                    |           |
      |   filename_download: kept-<run>.txt |           |
      |   type: text/plain                  |           |
      | remember_headers:                   |           |
      |   kept-upload: Location             |           |
      |   file: Directus-File-Id            |           |
      | method: PATCH                       | code: 204 |+
      | path: /files/tus/<kept-upload>      |           |
      | headers:                            |           |
      |   Tus-Resumable: 1.0.0              |           |
      |   Upload-Offset: '0'                |           |
      |   Content-Type: >-                  |           |
      |     application/offset+octet-stream |           |
      | body: kept                          |           |
    Then these requests get these responses:
      | request                                  | response                    |
      | method: POST                             | code: 500                   |+
      | path: /files/tus                         | text: "Something went wrong |
      | headers:                                 |   with that request\\n"     |
      |   Tus-Resumable: 1.0.0                   |                             |
      |   Upload-Length: '4'                     |                             |
      | upload_metadata:                         |                             |
      |   id: <file>                             |                             |
      |   filename_download: lost-<run>.txt      |                             |
      |   filename_disk: <file>.txt/below-a-file |                             |
      | method: GET                              | code: 200                   |+
      | path: /files                             | body:                       |
      | query:                                   |   data: []                  |
      |   fields: id                             |                             |
      |   filter[filename_download][_eq]: >-     |                             |
      |     lost-<run>.txt                       |                             |
      | method: GET                              | code: 200                   |+
      | path: /assets/<file>                     | text: kept                  |

  Scenario: an upload of an unknown type without extension is stored under its id
    Then these requests get these responses:
      | request                             | response                  |
      | method: POST                        | code: 201                 |+
      | path: /files/tus                    |                           |
      | headers:                            |                           |
      |   Tus-Resumable: 1.0.0              |                           |
      |   Upload-Length: '4'                |                           |
      | upload_metadata:                    |                           |
      |   filename_download: noext-<run>    |                           |
      |   type: application/x-unknown-thing |                           |
      | remember_headers:                   |                           |
      |   upload: Location                  |                           |
      |   file: Directus-File-Id            |                           |
      | method: PATCH                       | code: 204                 |+
      | path: /files/tus/<upload>           |                           |
      | headers:                            |                           |
      |   Tus-Resumable: 1.0.0              |                           |
      |   Upload-Offset: '0'                |                           |
      |   Content-Type: >-                  |                           |
      |     application/offset+octet-stream |                           |
      | body: blob                          |                           |
      | method: GET                         | code: 200                 |+
      | path: /files/<file>                 | body:                     |
      | query:                              |   data:                   |
      |   fields: filename_disk             |     filename_disk: <file> |

  Scenario: an upload naming an id no file holds reports the id it created
    Then these requests get these responses:
      | request                              | response         |
      | method: POST                         | code: 201        |+
      | path: /files/tus                     |                  |
      | headers:                             |                  |
      |   Tus-Resumable: 1.0.0               |                  |
      |   Upload-Length: '5'                 |                  |
      | upload_metadata:                     |                  |
      |   id: <unheld-id>                    |                  |
      |   filename_download: ghost-<run>.txt |                  |
      |   type: text/plain                   |                  |
      | remember_headers:                    |                  |
      |   upload: Location                   |                  |
      |   file: Directus-File-Id             |                  |
      | method: PATCH                        | code: 204        |+
      | path: /files/tus/<upload>            |                  |
      | headers:                             |                  |
      |   Tus-Resumable: 1.0.0               |                  |
      |   Upload-Offset: '0'                 |                  |
      |   Content-Type: >-                   |                  |
      |     application/offset+octet-stream  |                  |
      | body: ghost                          |                  |
      | method: GET                          | code: 200        |+
      | path: /files                         | body:            |
      | query:                               |   data:          |
      |   fields: id                         |     - id: <file> |
      |   filter[filename_download][_eq]: >- |                  |
      |     ghost-<run>.txt                  |                  |
