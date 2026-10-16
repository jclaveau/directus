Feature: A parent's o2m field given as an array is the whole list of its children

  - The array names each child by its key alone or as an object; a child the
    array leaves out is deselected: its parent nullified, or the child deleted
    where the relation's deselect action is `delete`.
  - Every key is a string the scenario chooses, all of one scenario's keys
    sharing a prefix of its own.
  - A Given creates its table's rows in one request; an empty cell is null.
  - A request authenticates as the admin. A response cell states the keys it
    checks.
  - A Then reads back every row whose key starts with the prefix, sorted by
    key, with the table's columns; a row the table leaves out does not exist.
  - `test_nested_o2m_list` keeps the default deselect action,
    `test_nested_o2m_bin` deletes. `test_nested_o2m_post` reaches
    `test_nested_o2m_tag` through the junction `test_nested_o2m_post_tag`.
  - Every request goes to an instance of the feature's own, sharing the
    database, that reports the statements each request ran
    (`QUERY_AUDIT_HEADER`). The last step counts a request's statements per
    table and kind, on postgres alone: other vendors run other statements.
  - Those counts are the baseline before the batched writes of #414, which
    are expected to drop them.

  Scenario: a child named by its key joins the parent, the ones left out are nullified
    Given the rows of test_nested_o2m_list:
      | id   |
      | ak-a |
      | ak-b |
    And their children in test_nested_o2m_list_entry:
      | id    | list |
      | ak-a1 | ak-a |
      | ak-a2 | ak-a |
      | ak-b1 | ak-b |
      | ak-x1 |      |
    When these requests get these responses:
      | request                                | response  |
      | method: PATCH                          | code: 200 |+
      | path: /items/test_nested_o2m_list/ak-a |           |
      | payload:                               |           |
      |   entries:                             |           |
      |     - ak-a1                            |           |
      |     - ak-b1                            |           |
      |     - ak-x1                            |           |
    Then the rows of test_nested_o2m_list_entry whose key starts with "ak-" are:
      | id    | list |
      | ak-a1 | ak-a |
      | ak-a2 |      |
      | ak-b1 | ak-a |
      | ak-x1 | ak-a |
    And on postgres the requests ran these statements:
      | request | table                      | select | insert | update | delete |
      | 1       | directus_activity          | 0      | 4      | 0      | 0      |
      | 1       | directus_revisions         | 0      | 3      | 0      | 0      |
      | 1       | directus_users             | 1      | 0      | 0      | 0      |
      | 1       | test_nested_o2m_list       | 3      | 0      | 0      | 0      |
      | 1       | test_nested_o2m_list_entry | 13     | 0      | 3      | 0      |

  Scenario: a child named by a key no row has is refused, writing nothing
    Given the rows of test_nested_o2m_list:
      | id   |
      | uk-a |
    And their children in test_nested_o2m_list_entry:
      | id    | list |
      | uk-a1 | uk-a |
      | uk-x1 |      |
    When these requests get these responses:
      | request                                | response                             |
      | method: PATCH                          | code: 403                            |+
      | path: /items/test_nested_o2m_list/uk-a | body:                                |
      | payload:                               |   errors:                            |
      |   entries:                             |     - message: >-                    |
      |     - uk-x1                            |         Could not find a             |
      |     - uk-ghost                         |         'test_nested_o2m_list_entry' |
      |                                        |         record having the            |
      |                                        |         primary key uk-ghost         |
      |                                        |         while processing O2M         |
      |                                        |         relation                     |
      |                                        |       extensions:                    |
      |                                        |         code: FORBIDDEN              |
    Then the rows of test_nested_o2m_list_entry whose key starts with "uk-" are:
      | id    | list |
      | uk-a1 | uk-a |
      | uk-x1 |      |

  Scenario: an object child with a key is updated, and moved when it is another's
    Given the rows of test_nested_o2m_list:
      | id   |
      | ob-a |
      | ob-b |
    And their children in test_nested_o2m_list_entry:
      | id    | list | name |
      | ob-a1 | ob-a | old  |
      | ob-b1 | ob-b | old  |
    When these requests get these responses:
      | request                                | response  |
      | method: PATCH                          | code: 200 |+
      | path: /items/test_nested_o2m_list/ob-a |           |
      | payload:                               |           |
      |   entries:                             |           |
      |     - id: ob-a1                        |           |
      |       name: renamed                    |           |
      |     - id: ob-b1                        |           |
      |       name: moved                      |           |
      |     - id: ob-n1                        |           |
      |       name: created                    |           |
    Then the rows of test_nested_o2m_list_entry whose key starts with "ob-" are:
      | id    | list | name    |
      | ob-a1 | ob-a | renamed |
      | ob-b1 | ob-a | moved   |
      | ob-n1 | ob-a | created |
    And on postgres the requests ran these statements:
      | request | table                      | select | insert | update | delete |
      | 1       | directus_activity          | 0      | 4      | 0      | 0      |
      | 1       | directus_revisions         | 0      | 3      | 0      | 0      |
      | 1       | directus_users             | 1      | 0      | 0      | 0      |
      | 1       | test_nested_o2m_list       | 3      | 0      | 0      | 0      |
      | 1       | test_nested_o2m_list_entry | 13     | 1      | 2      | 0      |

  Scenario: a batch deletes the children each parent leaves out when the relation deletes
    Given the rows of test_nested_o2m_bin:
      | id   |
      | dl-a |
      | dl-b |
    And their children in test_nested_o2m_bin_entry:
      | id    | bin  |
      | dl-a1 | dl-a |
      | dl-a2 | dl-a |
      | dl-b1 | dl-b |
      | dl-b2 | dl-b |
    When these requests get these responses:
      | request                          | response  |
      | method: PATCH                    | code: 200 |+
      | path: /items/test_nested_o2m_bin |           |
      | payload:                         |           |
      |   - id: dl-a                     |           |
      |     entries:                     |           |
      |       - dl-a2                    |           |
      |   - id: dl-b                     |           |
      |     entries:                     |           |
      |       - dl-b1                    |           |
    Then the rows of test_nested_o2m_bin_entry whose key starts with "dl-" are:
      | id    | bin  |
      | dl-a2 | dl-a |
      | dl-b1 | dl-b |
    And on postgres the requests ran these statements:
      | request | table                     | select | insert | update | delete |
      | 1       | directus_activity         | 0      | 4      | 0      | 0      |
      | 1       | directus_users            | 1      | 0      | 0      | 0      |
      | 1       | test_nested_o2m_bin       | 3      | 0      | 0      | 0      |
      | 1       | test_nested_o2m_bin_entry | 7      | 0      | 0      | 2      |

  Scenario: a null list deletes every child of its parent when the relation deletes
    Given the rows of test_nested_o2m_bin:
      | id   |
      | nl-a |
      | nl-b |
    And their children in test_nested_o2m_bin_entry:
      | id    | bin  |
      | nl-a1 | nl-a |
      | nl-a2 | nl-a |
      | nl-b1 | nl-b |
    When these requests get these responses:
      | request                               | response  |
      | method: PATCH                         | code: 200 |+
      | path: /items/test_nested_o2m_bin/nl-a |           |
      | payload:                              |           |
      |   entries: null                       |           |
    Then the rows of test_nested_o2m_bin_entry whose key starts with "nl-" are:
      | id    | bin  |
      | nl-b1 | nl-b |
    And on postgres the requests ran these statements:
      | request | table                     | select | insert | update | delete |
      | 1       | directus_activity         | 0      | 2      | 0      | 0      |
      | 1       | directus_users            | 1      | 0      | 0      | 0      |
      | 1       | test_nested_o2m_bin       | 3      | 0      | 0      | 0      |
      | 1       | test_nested_o2m_bin_entry | 3      | 0      | 0      | 1      |

  Scenario: a create of several parents links each its own children, moving one over
    Given the rows of test_nested_o2m_list:
      | id   |
      | mc-o |
    And their children in test_nested_o2m_list_entry:
      | id    | list |
      | mc-o1 | mc-o |
    When these requests get these responses:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /items/test_nested_o2m_list |           |
      | payload:                          |           |
      |   - id: mc-a                      |           |
      |     entries:                      |           |
      |       - id: mc-a1                 |           |
      |       - mc-o1                     |           |
      |   - id: mc-b                      |           |
      |     entries:                      |           |
      |       - id: mc-b1                 |           |
    Then the rows of test_nested_o2m_list_entry whose key starts with "mc-" are:
      | id    | list |
      | mc-a1 | mc-a |
      | mc-b1 | mc-b |
      | mc-o1 | mc-a |
    And on postgres the requests ran these statements:
      | request | table                      | select | insert | update | delete |
      | 1       | directus_activity          | 0      | 4      | 0      | 0      |
      | 1       | directus_revisions         | 0      | 4      | 2      | 0      |
      | 1       | directus_users             | 1      | 0      | 0      | 0      |
      | 1       | test_nested_o2m_list       | 1      | 1      | 0      | 0      |
      | 1       | test_nested_o2m_list_entry | 11     | 2      | 1      | 0      |

  Scenario: a batch swaps children between its parents, nullifying each one's others
    Given the rows of test_nested_o2m_list:
      | id   |
      | sw-a |
      | sw-b |
    And their children in test_nested_o2m_list_entry:
      | id    | list |
      | sw-a1 | sw-a |
      | sw-a2 | sw-a |
      | sw-b1 | sw-b |
      | sw-b2 | sw-b |
    When these requests get these responses:
      | request                           | response  |
      | method: PATCH                     | code: 200 |+
      | path: /items/test_nested_o2m_list |           |
      | payload:                          |           |
      |   - id: sw-a                      |           |
      |     entries:                      |           |
      |       - sw-b1                     |           |
      |   - id: sw-b                      |           |
      |     entries:                      |           |
      |       - id: sw-a1                 |           |
      |         name: swapped             |           |
    Then the rows of test_nested_o2m_list_entry whose key starts with "sw-" are:
      | id    | list | name    |
      | sw-a1 | sw-b | swapped |
      | sw-a2 |      |         |
      | sw-b1 | sw-a |         |
      | sw-b2 |      |         |
    And on postgres the requests ran these statements:
      | request | table                      | select | insert | update | delete |
      | 1       | directus_activity          | 0      | 6      | 0      | 0      |
      | 1       | directus_revisions         | 0      | 4      | 0      | 0      |
      | 1       | directus_users             | 1      | 0      | 0      | 0      |
      | 1       | test_nested_o2m_list       | 3      | 0      | 0      | 0      |
      | 1       | test_nested_o2m_list_entry | 15     | 0      | 4      | 0      |

  Scenario: an update of several keys naming an existing child is refused, writing nothing
    Given the rows of test_nested_o2m_list:
      | id   |
      | sk-a |
      | sk-b |
    And their children in test_nested_o2m_list_entry:
      | id    | list |
      | sk-a1 | sk-a |
      | sk-b1 | sk-b |
      | sk-x1 |      |
    When these requests get these responses:
      | request                           | response                         |
      | method: PATCH                     | code: 400                        |+
      | path: /items/test_nested_o2m_list | body:                            |
      | payload:                          |   errors:                        |
      |   keys:                           |     - message: >-                |
      |     - sk-a                        |         Invalid payload. "sk-x1" |
      |     - sk-b                        |         can't join more than one |
      |   data:                           |         "test_nested_o2m_list".  |
      |     entries:                      |       extensions:                |
      |       - sk-x1                     |         code: INVALID_PAYLOAD    |
      | method: PATCH                     | code: 400                        |+
      | path: /items/test_nested_o2m_list | body:                            |
      | payload:                          |   errors:                        |
      |   query:                          |     - message: >-                |
      |     filter:                       |         Invalid payload. "sk-x1" |
      |       id:                         |         can't join more than one |
      |         _starts_with: sk-         |         "test_nested_o2m_list".  |
      |   data:                           |       extensions:                |
      |     entries:                      |         code: INVALID_PAYLOAD    |
      |       - id: sk-x1                 |                                  |
      |         name: shared              |                                  |
    Then the rows of test_nested_o2m_list_entry whose key starts with "sk-" are:
      | id    | list | name |
      | sk-a1 | sk-a |      |
      | sk-b1 | sk-b |      |
      | sk-x1 |      |      |

  Scenario: a many-to-many list links junction rows and nullifies the ones left out
    Given the rows of test_nested_o2m_tag:
      | id    |
      | mm-t1 |
      | mm-t2 |
      | mm-t3 |
    When these requests get these responses:
      | request                                | response  |
      | method: POST                           | code: 200 |+
      | path: /items/test_nested_o2m_post      |           |
      | payload:                               |           |
      |   id: mm-p                             |           |
      |   tags:                                |           |
      |     - id: mm-j1                        |           |
      |       test_nested_o2m_tag_id: mm-t1    |           |
      |     - id: mm-j2                        |           |
      |       test_nested_o2m_tag_id: mm-t2    |           |
      | method: PATCH                          | code: 200 |+
      | path: /items/test_nested_o2m_post/mm-p |           |
      | payload:                               |           |
      |   tags:                                |           |
      |     - mm-j1                            |           |
      |     - id: mm-j3                        |           |
      |       test_nested_o2m_tag_id: mm-t3    |           |
    Then the rows of test_nested_o2m_post_tag whose key starts with "mm-" are:
      | id    | test_nested_o2m_post_id | test_nested_o2m_tag_id |
      | mm-j1 | mm-p                    | mm-t1                  |
      | mm-j2 |                         | mm-t2                  |
      | mm-j3 | mm-p                    | mm-t3                  |
    And on postgres the requests ran these statements:
      | request | table                    | select | insert | update | delete |
      | 1       | directus_activity        | 0      | 3      | 0      | 0      |
      | 1       | directus_revisions       | 0      | 3      | 1      | 0      |
      | 1       | directus_users           | 1      | 0      | 0      | 0      |
      | 1       | test_nested_o2m_post     | 1      | 1      | 0      | 0      |
      | 1       | test_nested_o2m_post_tag | 6      | 2      | 0      | 0      |
      | 2       | directus_activity        | 0      | 3      | 0      | 0      |
      | 2       | directus_revisions       | 0      | 2      | 0      | 0      |
      | 2       | directus_users           | 1      | 0      | 0      | 0      |
      | 2       | test_nested_o2m_post     | 3      | 0      | 0      | 0      |
      | 2       | test_nested_o2m_post_tag | 7      | 1      | 1      | 0      |
