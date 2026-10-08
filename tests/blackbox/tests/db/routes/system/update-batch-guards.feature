Feature: A batch update of a system collection is checked as a single update is

  - A batch reaches its service as one change per row, and each change is
    checked as the change of a single update is; a check that spans rows sees
    every row of the batch.
  - A row created in a `Given` is named by its `as` cell, and `<name>` in a
    later cell stands for its primary key; `<run>` for a value unique to this
    run. The `as` cell is not sent.
  - A request authenticates as the admin, or as the user its `as` cell names.
    A response cell states the keys it checks.

  Scenario: a batch setting a tfa_secret is refused and writes nothing
    Given the rows of /users:
      | as  | first_name | email                 |
      | tfa | tfa        | tfa-<run>@example.com |
    Then these requests get these responses:
      | request                 | response               |
      | method: PATCH           | code: 400              |+
      | path: /users            | body:                  |
      | payload:                |   errors:              |
      |   - id: <tfa>           |     - extensions:      |
      |     first_name: renamed |         reason: >-     |
      |     tfa_secret: x       |           You can't    |
      |                         |           change the   |
      |                         |           "tfa_secret" |
      |                         |           value        |
      |                         |           manually     |
      | method: GET             | code: 200              |+
      | path: /users/<tfa>      | body:                  |
      | query:                  |   data:                |
      |   fields: first_name    |     first_name: tfa    |

  Scenario: a batch giving two users one email is refused and writes nothing
    Given the rows of /users:
      | as  | first_name | email                 |
      | ann | ann        | ann-<run>@example.com |
      | bob | bob        | bob-<run>@example.com |
    Then these requests get these responses:
      | request                           | response                    |
      | method: PATCH                     | code: 400                   |+
      | path: /users                      | body:                       |
      | payload:                          |   errors:                   |
      |   - id: <ann>                     |     - extensions:           |
      |     email: same-<run>@example.com |         code:               |
      |   - id: <bob>                     |           RECORD_NOT_UNIQUE |
      |     email: same-<run>@example.com |         field: email        |
      | method: GET                       | code: 200                   |+
      | path: /users/<bob>                | body:                       |
      | query:                            |   data:                     |
      |   fields: email                   |     email: >-               |
      |                                   |       bob-<run>@example.com |

  Scenario: a batch naming a user its sender may not update is forbidden
    Given the rows of /users:
      | as    | first_name | email                   |
      | owner | owner      | owner-<run>@example.com |
      | other | other      | other-<run>@example.com |
    And a user who may update only their own row, as self
    Then these requests get these responses:
      | request                            | response                      |
      | as: self                           | code: 403                     |+
      | method: PATCH                      | body:                         |
      | path: /users                       |   errors:                     |
      | payload:                           |     - extensions:             |
      |   - id: <self>                     |         code: FORBIDDEN       |
      |     first_name: renamed            |                               |
      |   - id: <other>                    |                               |
      |     email: owner-<run>@example.com |                               |
      | method: GET                        | code: 200                     |+
      | path: /users/<self>                | body:                         |
      | query:                             |   data:                       |
      |   fields: first_name               |     first_name: self          |
      | method: GET                        | code: 200                     |+
      | path: /users/<other>               | body:                         |
      | query:                             |   data:                       |
      |   fields: email                    |     email: >-                 |
      |                                    |       other-<run>@example.com |

  Scenario: a batch making a role its own parent is refused and writes nothing
    Given the rows of /roles:
      | as   | name |
      | solo | solo |
    Then these requests get these responses:
      | request             | response                   |
      | method: PATCH       | code: 400                  |+
      | path: /roles        | body:                      |
      | payload:            |   errors:                  |
      |   - id: <solo>      |     - extensions:          |
      |     parent: <solo>  |         reason: >-         |
      |                     |           A role cannot be |
      |                     |           a parent of      |
      |                     |           itself           |
      | method: GET         | code: 200                  |+
      | path: /roles/<solo> | body:                      |
      | query:              |   data:                    |
      |   fields: parent    |     parent: null           |

  Scenario: a batch moving a role under its own child is refused, writing nothing
    Given the rows of /roles:
      | as    | name  | parent  |
      | elder | elder |         |
      | child | child | <elder> |
    Then these requests get these responses:
      | request              | response                     |
      | method: PATCH        | code: 400                    |+
      | path: /roles         | body:                        |
      | payload:             |   errors:                    |
      |   - id: <elder>      |     - extensions:            |
      |     parent: <child>  |         reason: >-           |
      |                      |           A role cannot have |
      |                      |           a parent that is   |
      |                      |           already a          |
      |                      |           descendant of      |
      |                      |           itself             |
      | method: GET          | code: 200                    |+
      | path: /roles/<elder> | body:                        |
      | query:               |   data:                      |
      |   fields: parent     |     parent: null             |

  Scenario: a batch putting two roles under each other is refused, writing nothing
    Given the rows of /roles:
      | as    | name  |
      | left  | left  |
      | right | right |
    Then these requests get these responses:
      | request              | response                     |
      | method: PATCH        | code: 400                    |+
      | path: /roles         | body:                        |
      | payload:             |   errors:                    |
      |   - id: <left>       |     - extensions:            |
      |     parent: <right>  |         reason: >-           |
      |   - id: <right>      |           A role cannot have |
      |     parent: <left>   |           a parent that is   |
      |                      |           already a          |
      |                      |           descendant of      |
      |                      |           itself             |
      | method: GET          | code: 200                    |+
      | path: /roles/<left>  | body:                        |
      | query:               |   data:                      |
      |   fields: parent     |     parent: null             |
      | method: GET          | code: 200                    |+
      | path: /roles/<right> | body:                        |
      | query:               |   data:                      |
      |   fields: parent     |     parent: null             |

  Scenario: a batch closing a loop through three roles is refused, writing nothing
    Given the rows of /roles:
      | as     | name   |
      | first  | first  |
      | second | second |
      | third  | third  |
    Then these requests get these responses:
      | request              | response                     |
      | method: PATCH        | code: 400                    |+
      | path: /roles         | body:                        |
      | payload:             |   errors:                    |
      |   - id: <first>      |     - extensions:            |
      |     parent: <second> |         reason: >-           |
      |   - id: <second>     |           A role cannot have |
      |     parent: <third>  |           a parent that is   |
      |   - id: <third>      |           already a          |
      |     parent: <first>  |           descendant of      |
      |                      |           itself             |
      | method: GET          | code: 200                    |+
      | path: /roles/<third> | body:                        |
      | query:               |   data:                      |
      |   fields: parent     |     parent: null             |

  Scenario: a batch moving a role under its child while freeing the child is applied
    Given the rows of /roles:
      | as    | name  | parent  |
      | elder | elder |         |
      | child | child | <elder> |
    Then these requests get these responses:
      | request              | response            |
      | method: PATCH        | code: 200           |+
      | path: /roles         |                     |
      | payload:             |                     |
      |   - id: <elder>      |                     |
      |     parent: <child>  |                     |
      |   - id: <child>      |                     |
      |     parent: null     |                     |
      | method: GET          | code: 200           |+
      | path: /roles/<elder> | body:               |
      | query:               |   data:             |
      |   fields: parent     |     parent: <child> |
      | method: GET          | code: 200           |+
      | path: /roles/<child> | body:               |
      | query:               |   data:             |
      |   fields: parent     |     parent: null    |

  Scenario: a batch setting an invalid ip_access on a policy is refused
    Given the rows of /policies:
      | as     | name   |
      | fenced | fenced |
    Then these requests get these responses:
      | request                  | response                    |
      | method: PATCH            | code: 400                   |+
      | path: /policies          | body:                       |
      | payload:                 |   errors:                   |
      |   - id: <fenced>         |     - extensions:           |
      |     ip_access:           |         reason: >-          |
      |       - not-an-ip        |           IP Access         |
      |                          |           contains an       |
      |                          |           incorrect value.  |
      |                          |           Valid values are: |
      |                          |           IP addresses, IP  |
      |                          |           ranges and CIDR   |
      |                          |           blocks            |
      | method: GET              | code: 200                   |+
      | path: /policies/<fenced> | body:                       |
      | query:                   |   data:                     |
      |   fields: ip_access      |     ip_access: null         |

  Scenario: a batch giving two translations one key and language is refused
    Given the rows of /translations:
      | as    | key         | language | value |
      | first | first-<run> | en-US    | one   |
      | other | other-<run> | en-US    | two   |
    Then these requests get these responses:
      | request                     | response                |
      | method: PATCH               | code: 400               |+
      | path: /translations         | body:                   |
      | payload:                    |   errors:               |
      |   - id: <first>             |     - extensions:       |
      |     key: same-<run>         |         reason: >-      |
      |   - id: <other>             |           Duplicate key |
      |     key: same-<run>         |           and language  |
      |                             |           combination   |
      | method: GET                 | code: 200               |+
      | path: /translations/<other> | body:                   |
      | query:                      |   data:                 |
      |   fields: key               |     key: other-<run>    |

  Scenario: a batch giving a version the reserved key "main" is refused
    Given the rows of /items/test_batch_guards_versioned:
      | as      | title   |
      | article | article |
    And the rows of /versions:
      | as    | key   | name  | collection                  | item        |
      | draft | draft | draft | test_batch_guards_versioned | "<article>" |
    Then these requests get these responses:
      | request                 | response                   |
      | method: PATCH           | code: 400                  |+
      | path: /versions         | body:                      |
      | payload:                |   errors:                  |
      |   - id: <draft>         |     - extensions:          |
      |     key: main           |         reason: >-         |
      |                         |           "main" is a      |
      |                         |           reserved version |
      |                         |           key              |
      | method: GET             | code: 200                  |+
      | path: /versions/<draft> | body:                      |
      | query:                  |   data:                    |
      |   fields: key           |     key: draft             |

  Scenario: a batch giving two versions of one item the same key is refused
    Given the rows of /items/test_batch_guards_versioned:
      | as     | title  |
      | report | report |
    And the rows of /versions:
      | as      | key     | name    | collection                  | item       |
      | draft-a | draft-a | draft-a | test_batch_guards_versioned | "<report>" |
      | draft-b | draft-b | draft-b | test_batch_guards_versioned | "<report>" |
    Then these requests get these responses:
      | request                   | response                                |
      | method: PATCH             | code: 422                               |+
      | path: /versions           | body:                                   |
      | payload:                  |   errors:                               |
      |   - id: <draft-a>         |     - extensions:                       |
      |     key: final            |         reason: >-                      |
      |   - id: <draft-b>         |           Cannot update multiple        |
      |     key: final            |           versions on "<report>" in     |
      |                           |           collection                    |
      |                           |           "test_batch_guards_versioned" |
      |                           |           to the same key "final"       |
      | method: GET               | code: 200                               |+
      | path: /versions/<draft-b> | body:                                   |
      | query:                    |   data:                                 |
      |   fields: key             |     key: draft-b                        |

  Scenario: a batch moving an email to a user while freeing it is applied
    Given the rows of /users:
      | as  | first_name | email                 |
      | ann | ann        | ann-<run>@example.com |
      | bob | bob        | bob-<run>@example.com |
    Then these requests get these responses:
      | request                          | response                    |
      | method: PATCH                    | code: 200                   |+
      | path: /users                     |                             |
      | payload:                         |                             |
      |   - id: <ann>                    |                             |
      |     email: new-<run>@example.com |                             |
      |   - id: <bob>                    |                             |
      |     email: ann-<run>@example.com |                             |
      | method: GET                      | code: 200                   |+
      | path: /users/<ann>               | body:                       |
      | query:                           |   data:                     |
      |   fields: email                  |     email: >-               |
      |                                  |       new-<run>@example.com |
      | method: GET                      | code: 200                   |+
      | path: /users/<bob>               | body:                       |
      | query:                           |   data:                     |
      |   fields: email                  |     email: >-               |
      |                                  |       ann-<run>@example.com |

  Scenario: a batch moving a translation key to a row while freeing it is applied
    Given the rows of /translations:
      | as    | key         | language | value |
      | first | first-<run> | en-US    | one   |
      | other | other-<run> | en-US    | two   |
    Then these requests get these responses:
      | request                     | response                 |
      | method: PATCH               | code: 200                |+
      | path: /translations         |                          |
      | payload:                    |                          |
      |   - id: <first>             |                          |
      |     key: new-<run>          |                          |
      |   - id: <other>             |                          |
      |     key: first-<run>        |                          |
      | method: GET                 | code: 200                |+
      | path: /translations/<first> | body:                    |
      | query:                      |   data:                  |
      |   fields: key               |     key: new-<run>       |
      | method: GET                 | code: 200                |+
      | path: /translations/<other> | body:                    |
      | query:                      |   data:                  |
      |   fields: key               |     key: first-<run>     |

  Scenario: a batch moving a version key to a version while freeing it is applied
    Given the rows of /items/test_batch_guards_versioned:
      | as    | title |
      | essay | essay |
    And the rows of /versions:
      | as      | key     | name    | collection                  | item      |
      | draft-a | draft-a | draft-a | test_batch_guards_versioned | "<essay>" |
      | draft-b | draft-b | draft-b | test_batch_guards_versioned | "<essay>" |
    Then these requests get these responses:
      | request                   | response          |
      | method: PATCH             | code: 200         |+
      | path: /versions           |                   |
      | payload:                  |                   |
      |   - id: <draft-a>         |                   |
      |     key: draft-c          |                   |
      |   - id: <draft-b>         |                   |
      |     key: draft-a          |                   |
      | method: GET               | code: 200         |+
      | path: /versions/<draft-a> | body:             |
      | query:                    |   data:           |
      |   fields: key             |     key: draft-c  |
      | method: GET               | code: 200         |+
      | path: /versions/<draft-b> | body:             |
      | query:                    |   data:           |
      |   fields: key             |     key: draft-a  |
