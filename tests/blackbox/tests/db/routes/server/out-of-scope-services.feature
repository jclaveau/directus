Feature: An instance serves no shares and no comments it did not allow

  - Shares (#657) and comments (#647) are on in every instance, with no
    variable for the boot to refuse: an instance leaving them out of
    OUT_OF_SCOPE_FEATURES_ALLOWED mounts neither route, and their services
    refuse whatever reaches them another way.
  - The feature runs against an instance of its own, whose list allows only
    the features the other suites run.
  - A request authenticates as the admin. A response cell states the keys it
    checks.

  Scenario: a share read answers that its route does not exist
    Then these requests get these responses:
      | request       | response                                    |
      | method: GET   | code: 404                                   |+
      | path: /shares | body:                                       |
      |               |   errors:                                   |
      |               |     - message: Route /shares doesn't exist. |
      |               |       extensions:                           |
      |               |         code: ROUTE_NOT_FOUND               |

  Scenario: a comment read answers that its route does not exist
    Then these requests get these responses:
      | request         | response                                      |
      | method: GET     | code: 404                                     |+
      | path: /comments | body:                                         |
      |                 |   errors:                                     |
      |                 |     - message: Route /comments doesn't exist. |
      |                 |       extensions:                             |
      |                 |         code: ROUTE_NOT_FOUND                 |

  Scenario: a share read through GraphQL is refused by the shares service
    Then these requests get these responses:
      | request                      | response                                 |
      | method: POST                 | code: 200                                |+
      | path: /graphql/system        | body:                                    |
      | payload:                     |   errors:                                |
      |   query: '{ shares { id } }' |     - message: >-                        |
      |                              |         Service "shares" is unavailable. |
      |                              |         It is out of the tested scope    |
      |                              |         (#657): add "shares" to          |
      |                              |         OUT_OF_SCOPE_FEATURES_ALLOWED    |
      |                              |         to run it untested.              |
      |                              |       extensions:                        |
      |                              |         code: SERVICE_UNAVAILABLE        |
