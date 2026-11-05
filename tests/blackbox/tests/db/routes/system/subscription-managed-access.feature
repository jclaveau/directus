Feature: The access a subscription grants is the subscriptions bundle's alone

  - A request authenticates as the admin unless its `as` names a token.
  - The instance loads the real `@scalabus/subscriptions` bundle and was
    bootstrapped, which creates its tables.
  - Its Mollie client calls a fake Mollie, answering what `Mollie holds`.
  - A `<name>` stands for one uuid, the same in the tables and the requests;
    `<granted_access>` is the access row the bundle stored.

  Scenario: a request cannot change a granted access, the end of the subscription can
    Given the rows of directus_policies:
      | id             | name         |
      | <plan_policy>  | Pro plan     |
      | <other_policy> | Other policy |
    And the rows of directus_users:
      | id               | email                  | token           |
      | <no_access_user> | no-access@example.com  | no-access-token |
      | <granted_user>   | subscribed@example.com |                 |
    And the rows of subscribers:
      | id | user           |
      | 1  | <granted_user> |
    And the rows of subscriber_customers:
      | id | subscriber | provider | provider_customer_id |
      | 1  | 1          | mollie   | cst_subscribed       |
    And the rows of subscription_plans:
      | id | code | name | policy        | amount | currency | interval | status |
      | 1  | pro  | Pro  | <plan_policy> | 1000   | EUR      | month    | active |
    And the rows of subscription_plan_references:
      | plan | provider | reference |
      | 1    | mollie   | pro-plan  |
    And Mollie holds this subscription:
      | payment    | customer       | subscription | plan_reference | status |
      | tr_renewal | cst_subscribed | sub_renewing | pro-plan       | active |
    When these requests get these responses:
      | request                               | response  |
      | method: POST                          | code: 200 |+
      | path: /subscriptions/webhooks/mollie  |           |
      | payload: id=tr_renewal                |           |
    Then this access is eventually stored:
      | user           | policy        | managed_by              |
      | <granted_user> | <plan_policy> | @scalabus/subscriptions |
    And these requests get these responses:
      | request                        | response                                       |
      | method: PATCH                  | code: 400                                      |+
      | path: /users/<granted_user>    | body:                                          |
      | payload:                       |   errors:                                      |
      |   policies:                    |     - message: >-                              |
      |     delete:                    |         Invalid payload. Access                |
      |       - <granted_access>       |         "<granted_access>" is managed by       |
      |                                |         "@scalabus/subscriptions", which alone |
      |                                |         changes it.                            |
      |                                |       extensions:                              |
      |                                |         code: INVALID_PAYLOAD                  |
      | method: DELETE                 | code: 400                                      |+
      | path: /access/<granted_access> | body:                                          |
      |                                |   errors:                                      |
      |                                |     - message: >-                              |
      |                                |         Invalid payload. Access                |
      |                                |         "<granted_access>" is managed by       |
      |                                |         "@scalabus/subscriptions", which alone |
      |                                |         changes it.                            |
      |                                |       extensions:                              |
      |                                |         code: INVALID_PAYLOAD                  |
      | method: PATCH                  | code: 400                                      |+
      | path: /access/<granted_access> | body:                                          |
      | payload:                       |   errors:                                      |
      |   policy: <other_policy>       |     - message: >-                              |
      |                                |         Invalid payload. Access                |
      |                                |         "<granted_access>" is managed by       |
      |                                |         "@scalabus/subscriptions", which alone |
      |                                |         changes it.                            |
      |                                |       extensions:                              |
      |                                |         code: INVALID_PAYLOAD                  |
      | method: PATCH                  | code: 400                                      |+
      | path: /access/<granted_access> | body:                                          |
      | payload:                       |   errors:                                      |
      |   managed_by: null             |     - message: >-                              |
      |                                |         Invalid payload. Access                |
      |                                |         "<granted_access>" is managed by       |
      |                                |         "@scalabus/subscriptions", which alone |
      |                                |         changes it.                            |
      |                                |       extensions:                              |
      |                                |         code: INVALID_PAYLOAD                  |
      | as: no-access-token            | code: 403                                      |+
      | method: PATCH                  | body:                                          |
      | path: /access/<granted_access> |   errors:                                      |
      | payload:                       |     - message: >-                              |
      |   policy: <other_policy>       |         You don't have permission to access    |
      |                                |         collection "directus_access" or it     |
      |                                |         does not exist. Queried in root.       |
      |                                |       extensions:                              |
      |                                |         code: FORBIDDEN                        |
      | method: PATCH                  | code: 200                                      |+
      | path: /access/<granted_access> | body:                                          |
      | payload:                       |   data:                                        |
      |   user: <granted_user>         |     id: <granted_access>                       |
      |   policy: <plan_policy>        |     user: <granted_user>                       |
      |   managed_by: >-               |     policy: <plan_policy>                      |
      |     @scalabus/subscriptions    |     managed_by: "@scalabus/subscriptions"      |
      | method: PATCH                  | code: 200                                      |+
      | path: /access/<granted_access> | body:                                          |
      | payload:                       |   data:                                        |
      |   sort: 3                      |     sort: 3                                    |
    When Mollie holds this subscription:
      | payment    | customer       | subscription | plan_reference | status    |
      | tr_renewal | cst_subscribed | sub_renewing | pro-plan       | suspended |
    And these requests get these responses:
      | request                               | response  |
      | method: POST                          | code: 200 |+
      | path: /subscriptions/webhooks/mollie  |           |
      | payload: id=tr_renewal                |           |
    Then this user eventually holds no access:
      | user           |
      | <granted_user> |
