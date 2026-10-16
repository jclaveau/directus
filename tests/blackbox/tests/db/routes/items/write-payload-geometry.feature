Feature: A geometry is written from GeoJSON and read back as GeoJSON

  - A request cell is YAML: `method`, `path`, `query`, `payload`. A list under
    `query` is sent joined by commas. A request authenticates as the admin.
  - A response cell states the `code` and the part of the `body` it checks; a
    list still has to hold as many items as it states.
  - `test_write_geo_spot` is keyed by strings the scenarios choose, keeps
    revisions, and its `spot` is a geometry point.

  Scenario: a point written as GeoJSON reads back as the same GeoJSON
    When these requests get these responses:
      | request                                  | response           |
      | method: POST                             | code: 200          |+
      | path: /items/test_write_geo_spot         |                    |
      | payload:                                 |                    |
      |   id: wg-read                            |                    |
      |   spot:                                  |                    |
      |     type: Point                          |                    |
      |     coordinates:                         |                    |
      |       - 1                                |                    |
      |       - 2                                |                    |
      | method: GET                              | code: 200          |+
      | path: /items/test_write_geo_spot/wg-read | body:              |
      |                                          |   data:            |
      |                                          |     spot:          |
      |                                          |       type: Point  |
      |                                          |       coordinates: |
      |                                          |         - 1        |
      |                                          |         - 2        |

  Scenario: the revision of an updated point holds the point as GeoJSON
    When these requests get these responses:
      | request                                        | response                |
      | method: POST                                   | code: 200               |+
      | path: /items/test_write_geo_spot               |                         |
      | payload:                                       |                         |
      |   id: wg-revision                              |                         |
      |   spot:                                        |                         |
      |     type: Point                                |                         |
      |     coordinates:                               |                         |
      |       - 1                                      |                         |
      |       - 2                                      |                         |
      | method: PATCH                                  | code: 200               |+
      | path: /items/test_write_geo_spot/wg-revision   |                         |
      | payload:                                       |                         |
      |   spot:                                        |                         |
      |     type: Point                                |                         |
      |     coordinates:                               |                         |
      |       - 3                                      |                         |
      |       - 4                                      |                         |
      | method: GET                                    | code: 200               |+
      | path: /revisions                               | body:                   |
      | query:                                         |   data:                 |
      |   filter[collection][_eq]: test_write_geo_spot |     - delta:            |
      |   filter[item][_eq]: wg-revision               |         id: wg-revision |
      |   fields: delta                                |         spot:           |
      |   sort: id                                     |           type: Point   |
      |                                                |           coordinates:  |
      |                                                |             - 1         |
      |                                                |             - 2         |
      |                                                |     - delta:            |
      |                                                |         spot:           |
      |                                                |           type: Point   |
      |                                                |           coordinates:  |
      |                                                |             - 3         |
      |                                                |             - 4         |
