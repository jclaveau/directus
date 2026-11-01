Feature: A nested write to users, roles or policies hands its user checks up

  - A request cell is YAML: `method`, `path`, `query`, `payload`. A list under
    `query` is sent joined by commas. A request authenticates as the admin.
  - A response cell states the `code` and the part of the `body` it checks; a
    list still has to hold as many items as it states.
  - A nested write that changes who counts as a user leaves the user checks to
    the write it is nested in; every write here passes them.
  - `test_write_user_link` is keyed by strings the scenarios choose; its
    `target` is an any-to-one field reaching `directus_users`, the collection
    named in `target_collection`.
  - Every user, role, policy and access row has a literal key starting
    `5e1f0000-`, and every user an email ending `@write.email`.

  Scenario: an any-to-one field creates the user it holds
    When these requests get these responses:
      | request                                      | response             |
      | method: POST                                 | code: 200            |+
      | path: /items/test_write_user_link            |                      |
      | payload:                                     |                      |
      |   id: wu-a2o-create                          |                      |
      |   target_collection: directus_users          |                      |
      |   target:                                    |                      |
      |     id: 5e1f0000-0000-4000-8000-000000000011 |                      |
      |     email: a2o-create@write.email            |                      |
      | method: GET                                  | code: 200            |+
      | path: /users                                 | body:                |
      | query:                                       |   data:              |
      |   filter[email][_eq]: a2o-create@write.email |     - status: active |
      |   fields: status                             |                      |

  Scenario: an any-to-one field activates the existing user it holds
    When these requests get these responses:
      | request                                           | response           |
      | method: POST                                      | code: 200          |+
      | path: /users                                      |                    |
      | payload:                                          |                    |
      |   id: 5e1f0000-0000-4000-8000-000000000012        |                    |
      |   email: a2o-update@write.email                   |                    |
      |   status: draft                                   |                    |
      | method: POST                                      | code: 200          |+
      | path: /items/test_write_user_link                 |                    |
      | payload:                                          |                    |
      |   id: wu-a2o-update                               |                    |
      |   target_collection: directus_users               |                    |
      |   target:                                         |                    |
      |     id: 5e1f0000-0000-4000-8000-000000000012      |                    |
      |     status: active                                |                    |
      | method: GET                                       | code: 200          |+
      | path: /users/5e1f0000-0000-4000-8000-000000000012 | body:              |
      |                                                   |   data:            |
      |                                                   |     status: active |

  Scenario: a user's policies given as an empty list delete its access rows
    When these requests get these responses:
      | request                                                  | response   |
      | method: POST                                             | code: 200  |+
      | path: /policies                                          |            |
      | payload:                                                 |            |
      |   id: 5e1f0000-0000-4000-8000-000000000002               |            |
      |   name: write integrity policy                           |            |
      | method: POST                                             | code: 200  |+
      | path: /users                                             |            |
      | payload:                                                 |            |
      |   id: 5e1f0000-0000-4000-8000-000000000013               |            |
      |   email: policies-emptied@write.email                    |            |
      | method: POST                                             | code: 200  |+
      | path: /access                                            |            |
      | payload:                                                 |            |
      |   id: 5e1f0000-0000-4000-8000-000000000021               |            |
      |   user: 5e1f0000-0000-4000-8000-000000000013             |            |
      |   policy: 5e1f0000-0000-4000-8000-000000000002           |            |
      | method: PATCH                                            | code: 200  |+
      | path: /users/5e1f0000-0000-4000-8000-000000000013        |            |
      | payload:                                                 |            |
      |   policies: []                                           |            |
      | method: GET                                              | code: 200  |+
      | path: /access                                            | body:      |
      | query:                                                   |   data: [] |
      |   filter[user][email][_eq]: policies-emptied@write.email |            |

  Scenario: a user's policies deleting an access row delete it
    When these requests get these responses:
      | request                                                  | response   |
      | method: POST                                             | code: 200  |+
      | path: /users                                             |            |
      | payload:                                                 |            |
      |   id: 5e1f0000-0000-4000-8000-000000000014               |            |
      |   email: policies-deleted@write.email                    |            |
      | method: POST                                             | code: 200  |+
      | path: /access                                            |            |
      | payload:                                                 |            |
      |   id: 5e1f0000-0000-4000-8000-000000000022               |            |
      |   user: 5e1f0000-0000-4000-8000-000000000014             |            |
      |   policy: 5e1f0000-0000-4000-8000-000000000002           |            |
      | method: PATCH                                            | code: 200  |+
      | path: /users/5e1f0000-0000-4000-8000-000000000014        |            |
      | payload:                                                 |            |
      |   policies:                                              |            |
      |     delete:                                              |            |
      |       - 5e1f0000-0000-4000-8000-000000000022             |            |
      | method: GET                                              | code: 200  |+
      | path: /access                                            | body:      |
      | query:                                                   |   data: [] |
      |   filter[user][email][_eq]: policies-deleted@write.email |            |

  Scenario: a role's users given as an empty list leave the role
    When these requests get these responses:
      | request                                           | response         |
      | method: POST                                      | code: 200        |+
      | path: /roles                                      |                  |
      | payload:                                          |                  |
      |   id: 5e1f0000-0000-4000-8000-000000000001        |                  |
      |   name: integrity                                 |                  |
      | method: POST                                      | code: 200        |+
      | path: /users                                      |                  |
      | payload:                                          |                  |
      |   id: 5e1f0000-0000-4000-8000-000000000015        |                  |
      |   email: role-emptied@write.email                 |                  |
      |   role: 5e1f0000-0000-4000-8000-000000000001      |                  |
      | method: PATCH                                     | code: 200        |+
      | path: /roles/5e1f0000-0000-4000-8000-000000000001 |                  |
      | payload:                                          |                  |
      |   users: []                                       |                  |
      | method: GET                                       | code: 200        |+
      | path: /users                                      | body:            |
      | query:                                            |   data:          |
      |   filter[email][_eq]: role-emptied@write.email    |     - role: null |
      |   fields: role                                    |                  |

  Scenario: a role's users creating a user put it in the role
    When these requests get these responses:
      | request                                           | response                |
      | method: PATCH                                     | code: 200               |+
      | path: /roles/5e1f0000-0000-4000-8000-000000000001 |                         |
      | payload:                                          |                         |
      |   users:                                          |                         |
      |     create:                                       |                         |
      |       - id: 5e1f0000-0000-4000-8000-000000000016  |                         |
      |         email: role-created@write.email           |                         |
      | method: GET                                       | code: 200               |+
      | path: /users                                      | body:                   |
      | query:                                            |   data:                 |
      |   filter[email][_eq]: role-created@write.email    |     - role:             |
      |   fields: role.name                               |         name: integrity |

  Scenario: a role's users updating a user outside it activate it and move it in
    When these requests get these responses:
      | request                                           | response                |
      | method: POST                                      | code: 200               |+
      | path: /users                                      |                         |
      | payload:                                          |                         |
      |   id: 5e1f0000-0000-4000-8000-000000000017        |                         |
      |   email: role-updated@write.email                 |                         |
      |   status: draft                                   |                         |
      | method: PATCH                                     | code: 200               |+
      | path: /roles/5e1f0000-0000-4000-8000-000000000001 |                         |
      | payload:                                          |                         |
      |   users:                                          |                         |
      |     update:                                       |                         |
      |       - id: 5e1f0000-0000-4000-8000-000000000017  |                         |
      |         status: active                            |                         |
      | method: GET                                       | code: 200               |+
      | path: /users                                      | body:                   |
      | query:                                            |   data:                 |
      |   filter[email][_eq]: role-updated@write.email    |     - status: active    |
      |   fields:                                         |       role:             |
      |     - status                                      |         name: integrity |
      |     - role.name                                   |                         |

  Scenario: a role's users deleting a user take it out of the role
    When these requests get these responses:
      | request                                           | response         |
      | method: POST                                      | code: 200        |+
      | path: /users                                      |                  |
      | payload:                                          |                  |
      |   id: 5e1f0000-0000-4000-8000-000000000018        |                  |
      |   email: role-deleted@write.email                 |                  |
      |   role: 5e1f0000-0000-4000-8000-000000000001      |                  |
      | method: PATCH                                     | code: 200        |+
      | path: /roles/5e1f0000-0000-4000-8000-000000000001 |                  |
      | payload:                                          |                  |
      |   users:                                          |                  |
      |     delete:                                       |                  |
      |       - 5e1f0000-0000-4000-8000-000000000018      |                  |
      | method: GET                                       | code: 200        |+
      | path: /users                                      | body:            |
      | query:                                            |   data:          |
      |   filter[email][_eq]: role-deleted@write.email    |     - role: null |
      |   fields: role                                    |                  |
