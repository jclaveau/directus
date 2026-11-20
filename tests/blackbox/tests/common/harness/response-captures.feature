Feature: A wrong response fails on its diff before any capture refusal

  A `<name>` a response cell meets first captures the uuid the response holds
  at its spot. A wrong response holds anything else there, and refusing the
  capture would hide what the response got wrong: the step fails on the diff
  of the response to the cell first, and refuses the capture only when the
  response matches the cell.

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
      expected { status: 403, body: { …(1) } } to match object { status: 200, …(1) }
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
