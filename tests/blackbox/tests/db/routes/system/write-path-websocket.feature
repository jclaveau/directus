Feature: Items written over the websocket answer with what was written

  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario. A response cell states the keys it checks.
  - A `websocket:` request is one `items` message sent on a socket of its own;
    its response is the reply carrying the message's uid.
  - Notes live in `test_wp_socket_notes`, keyed by a string `id`; the banner is
    the `test_wp_socket_banner` singleton.

  Scenario: a websocket create of one item answers with that item
    Then these requests get these responses:
      | request                                      | response           |
      | websocket:                                   | reply:             |+
      |   action: create                             |   type: items      |
      |   collection: test_wp_socket_notes           |   data:            |
      |   data:                                      |     id: solo-<run> |
      |     id: solo-<run>                           |     title: created |
      |     title: created                           |                    |
      | method: GET                                  | code: 200          |+
      | path: /items/test_wp_socket_notes/solo-<run> | body:              |
      |                                              |   data:            |
      |                                              |     id: solo-<run> |
      |                                              |     title: created |

  Scenario: a websocket update by id answers with the updated item
    Given these requests are sent:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /items/test_wp_socket_notes |           |
      | payload:                          |           |
      |   id: keyed-<run>                 |           |
      |   title: before                   |           |
    Then these requests get these responses:
      | request                            | response            |
      | websocket:                         | reply:              |+
      |   action: update                   |   type: items       |
      |   collection: test_wp_socket_notes |   data:             |
      |   id: keyed-<run>                  |     id: keyed-<run> |
      |   data:                            |     title: after    |
      |     title: after                   |                     |

  Scenario: a websocket update carrying an array writes each item its own change
    Given these requests are sent:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /items/test_wp_socket_notes |           |
      | payload:                          |           |
      |   - id: first-<run>               |           |
      |     title: before                 |           |
      |   - id: second-<run>              |           |
      |     title: before                 |           |
    Then these requests get these responses:
      | request                            | response               |
      | websocket:                         | reply:                 |+
      |   action: update                   |   type: items          |
      |   collection: test_wp_socket_notes |   data:                |
      |   data:                            |     - id: first-<run>  |
      |     - id: first-<run>              |       title: one       |
      |       title: one                   |     - id: second-<run> |
      |     - id: second-<run>             |       title: two       |
      |       title: two                   |                        |
      |   query:                           |                        |
      |     sort: [id]                     |                        |

  Scenario: a websocket update carrying a query writes every item it matches
    Given these requests are sent:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /items/test_wp_socket_notes |           |
      | payload:                          |           |
      |   - id: matched-<run>             |           |
      |     title: before                 |           |
      |   - id: unmatched-<run>           |           |
      |     title: before                 |           |
    Then these requests get these responses:
      | request                                           | response                |
      | websocket:                                        | reply:                  |+
      |   action: update                                  |   type: items           |
      |   collection: test_wp_socket_notes                |   data:                 |
      |   data:                                           |     - id: matched-<run> |
      |     title: queried                                |       title: queried    |
      |   query:                                          |                         |
      |     filter:                                       |                         |
      |       id:                                         |                         |
      |         _eq: matched-<run>                        |                         |
      | method: GET                                       | code: 200               |+
      | path: /items/test_wp_socket_notes/unmatched-<run> | body:                   |
      |                                                   |   data:                 |
      |                                                   |     title: before       |

  Scenario: a websocket delete by id answers with the deleted key
    Given these requests are sent:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /items/test_wp_socket_notes |           |
      | payload:                          |           |
      |   id: doomed-<run>                |           |
      |   title: before                   |           |
    Then these requests get these responses:
      | request                            | response             |
      | websocket:                         | reply:               |+
      |   action: delete                   |   type: items        |
      |   collection: test_wp_socket_notes |   data: doomed-<run> |
      |   id: doomed-<run>                 |                      |
      | method: GET                        | code: 200            |+
      | path: /items/test_wp_socket_notes  | body:                |
      | query:                             |   data: []           |
      |   filter[id][_eq]: doomed-<run>    |                      |

  Scenario: a websocket update of a singleton answers with the singleton
    Then these requests get these responses:
      | request                             | response                |
      | websocket:                          | reply:                  |+
      |   action: update                    |   type: items           |
      |   collection: test_wp_socket_banner |   data:                 |
      |   data:                             |     title: banner-<run> |
      |     title: banner-<run>             |                         |
      | method: GET                         | code: 200               |+
      | path: /items/test_wp_socket_banner  | body:                   |
      |                                     |   data:                 |
      |                                     |     title: banner-<run> |
