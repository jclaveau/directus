Feature: A wrong response fails on its diff before any capture refusal

  A `<name>` a response cell meets first captures the uuid the response holds
  at its spot. A wrong response holds anything else there, and refusing the
  capture would hide what the response got wrong: the step fails on the diff
  of the response to the cell first, and refuses the capture only when the
  response matches the cell.

  A capture met nowhere else in its scenario binds any uuid and checks nothing:
  most often a key's name misspelt. Loading the feature refuses it.

  Scenario: a refused request fails on its diff, not on its capture
    Given a response cell capturing <new-invite>:
      """
      status: 200
      body:
        data:
          id: <new-invite>
      """
    When it meets this response:
      """
      status: 403
      body:
        errors:
          - message: You don't have permission to access this.
      """
    Then the step fails with the message:
      """
      expected { status: 403, …(1) } to match object { status: 200, …(1) }
      (1 matching property omitted from actual)
      """

  Scenario: a matching response holding no uuid at the spot fails on its capture
    Given a response cell capturing <new-invite>:
      """
      status: 200
      body:
        data:
          id: <new-invite>
      """
    When it meets this response:
      """
      status: 200
      body:
        data:
          id: admin@default.com
      """
    Then the step fails with the message:
      """
      Placeholder "<new-invite>" captures only a uuid, received "admin@default.com"
      """

  Scenario: a capture met nowhere else in its scenario is refused, naming it
    Given a feature holding this scenario:
      ```
      Feature: roles

        Scenario: a misspelt key
          Given the rows of directus_roles:
            | id            | name        |
            | <editor-role> | editor-run  |
          Then these requests get these responses:
            | request             | response                   |
            | method: GET         | code: 200                  |+
            | path: /users/me     | body:                      |
            |                     |   data:                    |
            |                     |     role: <editor_role>    |
      ```
    Then loading it fails with the message:
      """
      Placeholder "<editor_role>" in a response of "a misspelt key" is met nowhere else in
      it: a capture nothing reuses checks nothing
      """

  Scenario: a capture a later request reuses loads
    Given a feature holding this scenario:
      ```
      Feature: invites

        Scenario: a new invite read back
          Then these requests get these responses:
            | request                        | response           |
            | method: POST                   | code: 200          |+
            | path: /items/notes             | body:              |
            |                                |   data:            |
            |                                |     id: <new-note> |
            | method: GET                    | code: 200          |+
            | path: /items/notes/<new-note>  |                    |
      ```
    Then loading it passes
