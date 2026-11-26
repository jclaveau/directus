Feature: A boolean variable that holds no boolean ends the boot before it listens

  A variable typed boolean reads true from true or 1, and false from false or 0.
  Any other value used to read as false without a word: CACHE_ENABLED=TRUE
  turned the cache off. The env now refuses it while it is built, whichever
  layer supplied it (the process env, the config file or a _FILE secret), so the
  instance exits with code 1 before it listens, and its stderr says why.

  An empty value is refused too: a deployment that wrote CACHE_ENABLED= to mean
  false has to write false (the upgrade note of #773).

  A _FILE secret is trimmed before it is read as a boolean: docker and k8s write
  a secret with a trailing newline, which no boolean parses with.

  Scenario: TRUE in the process env ends the boot
    Given the process env sets CACHE_ENABLED to "TRUE"
    When an instance starts
    Then the instance exits with code 1, never having answered /server/ping
    And its stderr holds this error:
      """
      "CACHE_ENABLED" Environment Variable is "TRUE", which is not a boolean.
      Use one of true, false, 1, 0.
      """

  Scenario: yes in the config file ends the boot
    Given the config file sets CACHE_ENABLED to "yes"
    When an instance starts
    Then the instance exits with code 1, never having answered /server/ping
    And its stderr holds this error:
      """
      "CACHE_ENABLED" Environment Variable is "yes", which is not a boolean.
      Use one of true, false, 1, 0.
      """

  Scenario: yes in a _FILE secret ends the boot
    Given the secret file of CACHE_ENABLED_FILE holds "yes\n"
    When an instance starts
    Then the instance exits with code 1, never having answered /server/ping
    And its stderr holds this error:
      """
      "CACHE_ENABLED" Environment Variable is "yes", which is not a boolean.
      Use one of true, false, 1, 0.
      """

  Scenario: an empty value in the process env ends the boot
    Given the process env sets CACHE_ENABLED to ""
    When an instance starts
    Then the instance exits with code 1, never having answered /server/ping
    And its stderr holds this error:
      """
      "CACHE_ENABLED" Environment Variable is "", which is not a boolean.
      Use one of true, false, 1, 0.
      """

  # GRAPHQL_INTROSPECTION, as a _FILE secret is read only for a listed
  # variable, and a schema query answers only while introspection is on. An
  # untrimmed "true\n" read as false and refused it.
  Scenario: true and a newline in a _FILE secret reads as true
    Given the secret file of GRAPHQL_INTROSPECTION_FILE holds "true\n"
    When an instance starts
    Then the instance answers /server/ping
    And these requests get these responses:
      | request                                 | response              |
      | method: POST                            | code: 200             |+
      | path: /graphql                          | body:                 |
      | payload:                                |   data:               |
      |   query: '{ __schema { queryType { name |     __schema:         |
      |     } } }'                              |       queryType:      |
      |                                         |         name: Query   |
