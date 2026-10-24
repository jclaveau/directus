Feature: A version is saved, renamed and promoted onto its item

  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario, and `<name>` for the value a `remember` row stored: the
    created key for `remember: name`, the value at each path for a mapping. A
    response cell states the keys it checks.
  - Posts live in `test_wp_draft_posts`, keyed by a string `id`; the banner is
    the `test_wp_draft_banner` singleton. Both have versioning on.

  Scenario: a saved version promoted with the main hash writes its delta to the item
    Given these requests are sent:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /items/test_wp_draft_posts  |           |
      | payload:                          |           |
      |   id: post-<run>                  |           |
      |   title: before                   |           |
      |   summary: kept                   |           |
      | method: POST                      | code: 200 |+
      | path: /versions                   |           |
      | payload:                          |           |
      |   key: draft                      |           |
      |   collection: test_wp_draft_posts |           |
      |   item: post-<run>                |           |
      | remember: draft                   |           |
      | method: POST                      | code: 200 |+
      | path: /versions/<draft>/save      |           |
      | payload:                          |           |
      |   title: promoted                 |           |
    Then these requests get these responses:
      | request                                     | response            |
      | method: GET                                 | code: 200           |+
      | path: /versions/<draft>/compare             | body:               |
      | remember:                                   |   data:             |
      |   main_hash: body.data.mainHash             |     outdated: false |
      | method: POST                                | code: 200           |+
      | path: /versions/<draft>/promote             | body:               |
      | payload:                                    |   data: post-<run>  |
      |   mainHash: '<main_hash>'                   |                     |
      | method: GET                                 | code: 200           |+
      | path: /items/test_wp_draft_posts/post-<run> | body:               |
      |                                             |   data:             |
      |                                             |     title: promoted |
      |                                             |     summary: kept   |

  Scenario: a promote naming its fields writes only those fields
    Given these requests are sent:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /items/test_wp_draft_posts  |           |
      | payload:                          |           |
      |   id: picked-<run>                |           |
      |   title: before                   |           |
      |   summary: kept                   |           |
      | method: POST                      | code: 200 |+
      | path: /versions                   |           |
      | payload:                          |           |
      |   key: draft                      |           |
      |   collection: test_wp_draft_posts |           |
      |   item: picked-<run>              |           |
      | remember: draft                   |           |
      | method: POST                      | code: 200 |+
      | path: /versions/<draft>/save      |           |
      | payload:                          |           |
      |   title: picked                   |           |
      |   summary: dropped                |           |
      | method: GET                       | code: 200 |+
      | path: /versions/<draft>/compare   |           |
      | remember:                         |           |
      |   main_hash: body.data.mainHash   |           |
    Then these requests get these responses:
      | request                                       | response             |
      | method: POST                                  | code: 200            |+
      | path: /versions/<draft>/promote               | body:                |
      | payload:                                      |   data: picked-<run> |
      |   mainHash: '<main_hash>'                     |                      |
      |   fields: [title]                             |                      |
      | method: GET                                   | code: 200            |+
      | path: /items/test_wp_draft_posts/picked-<run> | body:                |
      |                                               |   data:              |
      |                                               |     title: picked    |
      |                                               |     summary: kept    |

  Scenario: a version with nothing saved has no changes to promote
    Given these requests are sent:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /items/test_wp_draft_posts  |           |
      | payload:                          |           |
      |   id: idle-<run>                  |           |
      |   title: before                   |           |
      | method: POST                      | code: 200 |+
      | path: /versions                   |           |
      | payload:                          |           |
      |   key: draft                      |           |
      |   collection: test_wp_draft_posts |           |
      |   item: idle-<run>                |           |
      | remember: draft                   |           |
    Then these requests get these responses:
      | request                         | response                                  |
      | method: POST                    | code: 422                                 |+
      | path: /versions/<draft>/promote | body:                                     |
      | payload:                        |   errors:                                 |
      |   mainHash: any-hash            |     - message: >-                         |
      |                                 |         Can't process content. No changes |
      |                                 |         to promote.                       |

  Scenario: a promote over a main item changed since is refused
    Given these requests are sent:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /items/test_wp_draft_posts  |           |
      | payload:                          |           |
      |   id: stale-<run>                 |           |
      |   title: before                   |           |
      | method: POST                      | code: 200 |+
      | path: /versions                   |           |
      | payload:                          |           |
      |   key: draft                      |           |
      |   collection: test_wp_draft_posts |           |
      |   item: stale-<run>               |           |
      | remember: draft                   |           |
      | method: POST                      | code: 200 |+
      | path: /versions/<draft>/save      |           |
      | payload:                          |           |
      |   title: drafted                  |           |
    Then these requests get these responses:
      | request                          | response                                 |
      | method: POST                     | code: 422                                |+
      | path: /versions/<draft>/promote  | body:                                    |
      | payload:                         |   errors:                                |
      |   mainHash: stale-hash           |     - message: >-                        |
      |                                  |         Can't process content. Main item |
      |                                  |         has changed since this           |
      |                                  |         version was last updated.        |
      | method: GET                      | code: 200                                |+
      | path: /items/test_wp_draft_posts | body:                                    |
      | query:                           |   data:                                  |
      |   filter[id][_eq]: stale-<run>   |     - title: before                      |

  Scenario: a promote without a main hash is refused
    Then these requests get these responses:
      | request                           | response                            |
      | method: POST                      | code: 400                           |+
      | path: /versions/<missing>/promote | body:                               |
      | payload:                          |   errors:                           |
      |   fields: [title]                 |     - message: >-                   |
      |                                   |         Invalid payload. "mainHash" |
      |                                   |         field is required.          |

  Scenario: an item read through a version never saved is the item itself
    Given these requests are sent:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /items/test_wp_draft_posts  |           |
      | payload:                          |           |
      |   id: unsaved-<run>               |           |
      |   title: before                   |           |
      | method: POST                      | code: 200 |+
      | path: /versions                   |           |
      | payload:                          |           |
      |   key: draft                      |           |
      |   collection: test_wp_draft_posts |           |
      |   item: unsaved-<run>             |           |
    Then these requests get these responses:
      | request                                        | response          |
      | method: GET                                    | code: 200         |+
      | path: /items/test_wp_draft_posts/unsaved-<run> | body:             |
      | query:                                         |   data:           |
      |   version: draft                               |     title: before |

  Scenario: a singleton read through a saved version holds the saved change
    Given these requests are sent:
      | request                            | response  |
      | method: PATCH                      | code: 200 |+
      | path: /items/test_wp_draft_banner  |           |
      | payload:                           |           |
      |   title: main-<run>                |           |
      | remember: banner                   |           |
      | method: POST                       | code: 200 |+
      | path: /versions                    |           |
      | payload:                           |           |
      |   key: draft-<run>                 |           |
      |   collection: test_wp_draft_banner |           |
      |   item: '<banner>'                 |           |
      | remember: draft                    |           |
      | method: POST                       | code: 200 |+
      | path: /versions/<draft>/save       |           |
      | payload:                           |           |
      |   title: drafted-<run>             |           |
    Then these requests get these responses:
      | request                           | response                 |
      | method: GET                       | code: 200                |+
      | path: /items/test_wp_draft_banner | body:                    |
      | query:                            |   data:                  |
      |   version: draft-<run>            |     title: drafted-<run> |
      | method: GET                       | code: 200                |+
      | path: /items/test_wp_draft_banner | body:                    |
      |                                   |   data:                  |
      |                                   |     title: main-<run>    |

  Scenario: a save carrying nothing leaves the version's delta as it was
    Given these requests are sent:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /items/test_wp_draft_posts  |           |
      | payload:                          |           |
      |   id: empty-save-<run>            |           |
      |   title: before                   |           |
      | method: POST                      | code: 200 |+
      | path: /versions                   |           |
      | payload:                          |           |
      |   key: draft                      |           |
      |   collection: test_wp_draft_posts |           |
      |   item: empty-save-<run>          |           |
      | remember: draft                   |           |
      | method: POST                      | code: 200 |+
      | path: /versions/<draft>/save      |           |
      | payload:                          |           |
      |   title: drafted                  |           |
    Then these requests get these responses:
      | request                      | response                 |
      | method: POST                 | code: 200                |+
      | path: /versions/<draft>/save | body:                    |
      | payload: {}                  |   data:                  |
      |                              |     id: empty-save-<run> |
      |                              |     title: drafted       |
      | method: GET                  | code: 200                |+
      | path: /versions/<draft>      | body:                    |
      |                              |   data:                  |
      |                              |     delta:               |
      |                              |       title: drafted     |

  Scenario: a version patched with only a new name keeps its key
    Given these requests are sent:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /items/test_wp_draft_posts  |           |
      | payload:                          |           |
      |   id: named-<run>                 |           |
      |   title: before                   |           |
      | method: POST                      | code: 200 |+
      | path: /versions                   |           |
      | payload:                          |           |
      |   key: draft                      |           |
      |   name: first name                |           |
      |   collection: test_wp_draft_posts |           |
      |   item: named-<run>               |           |
      | remember: draft                   |           |
    Then these requests get these responses:
      | request                 | response              |
      | method: PATCH           | code: 200             |+
      | path: /versions/<draft> | body:                 |
      | payload:                |   data:               |
      |   name: second name     |     key: draft        |
      |                         |     name: second name |

  Scenario: a version patched with a field other than its key or name is refused
    Given these requests are sent:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /items/test_wp_draft_posts  |           |
      | payload:                          |           |
      |   id: moved-<run>                 |           |
      |   title: before                   |           |
      | method: POST                      | code: 200 |+
      | path: /versions                   |           |
      | payload:                          |           |
      |   key: draft                      |           |
      |   collection: test_wp_draft_posts |           |
      |   item: moved-<run>               |           |
      | remember: draft                   |           |
    Then these requests get these responses:
      | request                 | response                           |
      | method: PATCH           | code: 400                          |+
      | path: /versions/<draft> | body:                              |
      | payload:                |   errors:                          |
      |   item: elsewhere-<run> |     - message: >-                  |
      |                         |         Invalid payload. "item" is |
      |                         |         not allowed.               |

  Scenario: a version renamed to a key its item already holds is refused
    Given these requests are sent:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /items/test_wp_draft_posts  |           |
      | payload:                          |           |
      |   id: taken-<run>                 |           |
      |   title: before                   |           |
      | method: POST                      | code: 200 |+
      | path: /versions                   |           |
      | payload:                          |           |
      |   key: draft                      |           |
      |   collection: test_wp_draft_posts |           |
      |   item: taken-<run>               |           |
      | method: POST                      | code: 200 |+
      | path: /versions                   |           |
      | payload:                          |           |
      |   key: review                     |           |
      |   collection: test_wp_draft_posts |           |
      |   item: taken-<run>               |           |
      | remember: review                  |           |
    Then these requests get these responses:
      | request                  | response                                |
      | method: PATCH            | code: 422                               |+
      | path: /versions/<review> | body:                                   |
      | payload:                 |   errors:                               |
      |   key: draft             |     - message: >-                       |
      |                          |         Can't process content. Version  |
      |                          |         "draft" already exists for item |
      |                          |         "taken-<run>" in collection     |
      |                          |         "test_wp_draft_posts".          |

  Scenario: versions patched by a query take the change
    Given these requests are sent:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /items/test_wp_draft_posts  |           |
      | payload:                          |           |
      |   id: queried-<run>               |           |
      |   title: before                   |           |
      | method: POST                      | code: 200 |+
      | path: /versions                   |           |
      | payload:                          |           |
      |   key: draft                      |           |
      |   collection: test_wp_draft_posts |           |
      |   item: queried-<run>             |           |
      | remember: draft                   |           |
    Then these requests get these responses:
      | request              | response            |
      | method: PATCH        | code: 200           |+
      | path: /versions      | body:               |
      | payload:             |   data:             |
      |   query:             |     - id: <draft>   |
      |     filter:          |       name: queried |
      |       id:            |                     |
      |         _eq: <draft> |                     |
      |   data:              |                     |
      |     name: queried    |                     |

  Scenario: versions created in one batch are each created
    Given these requests are sent:
      | request                          | response  |
      | method: POST                     | code: 200 |+
      | path: /items/test_wp_draft_posts |           |
      | payload:                         |           |
      |   id: batched-<run>              |           |
      |   title: before                  |           |
    Then these requests get these responses:
      | request                             | response                  |
      | method: POST                        | code: 200                 |+
      | path: /versions                     | body:                     |
      | query:                              |   data:                   |
      |   sort: key                         |     - key: draft          |
      | payload:                            |       item: batched-<run> |
      |   - key: draft                      |     - key: review         |
      |     collection: test_wp_draft_posts |       item: batched-<run> |
      |     item: batched-<run>             |                           |
      |   - key: review                     |                           |
      |     collection: test_wp_draft_posts |                           |
      |     item: batched-<run>             |                           |

  Scenario: two versions of one key for one item in one batch are refused
    Given these requests are sent:
      | request                          | response  |
      | method: POST                     | code: 200 |+
      | path: /items/test_wp_draft_posts |           |
      | payload:                         |           |
      |   id: twin-<run>                 |           |
      |   title: before                  |           |
    Then these requests get these responses:
      | request                             | response                               |
      | method: POST                        | code: 422                              |+
      | path: /versions                     | body:                                  |
      | payload:                            |   errors:                              |
      |   - key: twin                       |     - message: >-                      |
      |     collection: test_wp_draft_posts |         Can't process content. Cannot  |
      |     item: twin-<run>                |         create multiple versions on    |
      |   - key: twin                       |         "twin-<run>" in collection     |
      |     collection: test_wp_draft_posts |         "test_wp_draft_posts" with the |
      |     item: twin-<run>                |         same key "twin".               |
      | method: GET                         | code: 200                              |+
      | path: /versions                     | body:                                  |
      | query:                              |   data: []                             |
      |   filter[item][_eq]: twin-<run>     |                                        |
