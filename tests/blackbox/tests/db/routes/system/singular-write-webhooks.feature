Feature: A single webhook is deleted by its key

  - A request authenticates as the admin. A response cell states the keys it
    checks.
  - Webhooks are deprecated and none can be created, so the key deleted is one
    no webhook holds.

  Scenario: deleting a webhook by a key no webhook holds is not found
    Then these requests get these responses:
      | request                    | response                     |
      | method: DELETE             | code: 404                    |+
      | path: /webhooks/2147483000 | body:                        |
      |                            |   errors:                    |
      |                            |     - message: >-            |
      |                            |         Item "2147483000"    |
      |                            |         doesn't exist in     |
      |                            |         collection           |
      |                            |         "directus_webhooks". |
