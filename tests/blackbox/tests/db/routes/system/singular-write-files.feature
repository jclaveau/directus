Feature: A file's record is written one at a time or in batches, its data replaced

  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and any other `<name>` for a uuid of its own, or for the key
    a `remember: name` row stored. A response cell states the keys it checks.
  - A request holding a `file` is sent as a multipart upload: its `form` fields
    first, then the file under its `name`, holding its `content`.

  Scenario: a file's record is edited one by one and in batches
    Given these requests are sent:
      | request                  | response  |
      | method: POST             | code: 200 |+
      | path: /files             |           |
      | form:                    |           |
      |   title: edited-<run>    |           |
      | file:                    |           |
      |   name: edited-<run>.txt |           |
      |   content: edited        |           |
      | remember: edited         |           |
    Then these requests get these responses:
      | request                     | response                   |
      | method: PATCH               | code: 200                  |+
      | path: /files/<edited>       | body:                      |
      | query:                      |   data:                    |
      |   fields: title,description |     title: edited-<run>    |
      | payload:                    |     description: one       |
      |   description: one          |                            |
      | method: PATCH               | code: 200                  |+
      | path: /files                | body:                      |
      | query:                      |   data:                    |
      |   fields: description       |     - description: batch   |
      | payload:                    |                            |
      |   - id: <edited>            |                            |
      |     description: batch      |                            |
      | method: PATCH               | code: 200                  |+
      | path: /files                | body:                      |
      | query:                      |   data:                    |
      |   fields: title,description |     - title: edited-<run>  |
      | payload:                    |       description: queried |
      |   query:                    |                            |
      |     filter:                 |                            |
      |       title:                |                            |
      |         _eq: edited-<run>   |                            |
      |   data:                     |                            |
      |     description: queried    |                            |

  Scenario: a file uploaded again under its key takes the new data's name and type
    Given these requests are sent:
      | request                 | response  |
      | method: POST            | code: 200 |+
      | path: /files            |           |
      | form:                   |           |
      |   title: replaced-<run> |           |
      | file:                   |           |
      |   name: first.txt       |           |
      |   content: first        |           |
      | remember: replaced      |           |
    Then these requests get these responses:
      | request                                | response                          |
      | method: GET                            | code: 200                         |+
      | path: /files/<replaced>                | body:                             |
      | query:                                 |   data:                           |
      |   fields: title,type,filename_download |     title: replaced-<run>         |
      |                                        |     type: text/plain              |
      |                                        |     filename_download: first.txt  |
      | method: GET                            | code: 200                         |+
      | path: /files/<replaced>                | body:                             |
      | query:                                 |   data:                           |
      |   fields: filename_disk                |     filename_disk: <replaced>.txt |
      | method: PATCH                          | code: 200                         |+
      | path: /files/<replaced>                | body:                             |
      | query:                                 |   data:                           |
      |   fields: title,type,filename_download |     title: replaced-<run>         |
      | file:                                  |     type: text/csv                |
      |   name: second.csv                     |     filename_download: second.csv |
      |   content: second,data                 |                                   |
      | method: GET                            | code: 200                         |+
      | path: /files/<replaced>                | body:                             |
      | query:                                 |   data:                           |
      |   fields: filename_disk                |     filename_disk: <replaced>.csv |
