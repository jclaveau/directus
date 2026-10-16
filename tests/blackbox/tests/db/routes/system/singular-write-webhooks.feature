Feature: A single webhook is deleted by its key

  - A request authenticates as the admin. A response cell states the keys it
    checks.
  - Webhooks are deprecated and none can be created, so the key deleted is one
    no webhook holds.

  Scenario: deleting a webhook by a key no webhook holds answers with no content
    Then these requests get these responses:
      | request                    | response  |
      | method: DELETE             | code: 204 |+
      | path: /webhooks/2147483000 |           |
