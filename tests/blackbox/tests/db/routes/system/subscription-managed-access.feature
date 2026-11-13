Feature: The access a subscription grants is the subscriptions bundle's alone

  - A request authenticates as the admin unless its `as` names a token;
    `as: anonymous` sends none, like Mollie.
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
      | id | code | name | policy        | amount | currency | interval     | status |
      | 1  | pro  | Pro  | <plan_policy> | 1000   | EUR      | {"months":1} | active |
    And the rows of subscription_plan_references:
      | plan | provider | reference |
      | 1    | mollie   | pro-plan  |
    And Mollie holds this subscription:
      | payment    | customer       | subscription | plan_reference | status |
      | tr_renewal | cst_subscribed | sub_renewing | pro-plan       | active |
    When these requests get these responses:
      | request                               | response  |
      | as: anonymous                         | code: 200 |+
      | method: POST                          |           |
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
      | as: anonymous                         | code: 200 |+
      | method: POST                          |           |
      | path: /subscriptions/webhooks/mollie  |           |
      | payload: id=tr_renewal                |           |
    Then this user eventually holds no access:
      | user           |
      | <granted_user> |

  Scenario: a request cannot write around the bundle
    Given the rows of directus_policies:
      | id       | name          |
      | <policy> | Direct policy |
    And the rows of directus_users:
      | id             | email               | token         |
      | <refused_user> | refused@example.com | refused-token |
    And the rows of subscribers:
      | id | user |
      | 10 |      |
    And the rows of subscriber_customers:
      | id | subscriber | provider | provider_customer_id |
      | 10 | 10         | mollie   | cst_direct           |
    And the rows of subscription_plans:
      | id | code   | name   | policy   | amount | currency | interval     | status   |
      | 10 | direct | Direct | <policy> | 1000   | EUR      | {"months":1} | active   |
      | 11 | gone   | Gone   | <policy> | 1000   | EUR      | {"months":1} | archived |
    And the rows of subscription_plan_references:
      | id | plan | provider | reference   |
      | 10 | 10   | mollie   | direct-plan |
    And this row of subscriptions:
      | column                   | value      |
      | id                       | 900        |
      | subscriber               | 10         |
      | customer                 | 10         |
      | plan_reference           | 10         |
      | provider                 | mollie     |
      | provider_subscription_id | sub_direct |
      | status                   | expired    |
      | date_created             | 2026-01-01 |
      | date_updated             | 2026-01-01 |
    Then these requests get these responses:
      | request                            | response                                   |
      | as: anonymous                      | code: 403                                  |+
      | method: DELETE                     | body:                                      |
      | path: /items/subscription_plans/10 |   errors:                                  |
      |                                    |     - message: >-                          |
      |                                    |         You don't have permission to       |
      |                                    |         access collection                  |
      |                                    |         "subscription_plans" or it does    |
      |                                    |         not exist. Queried in root.        |
      |                                    |       extensions:                          |
      |                                    |         code: FORBIDDEN                    |
      | as: refused-token                  | code: 403                                  |+
      | method: DELETE                     | body:                                      |
      | path: /items/subscription_plans/10 |   errors:                                  |
      |                                    |     - message: >-                          |
      |                                    |         You don't have permission to       |
      |                                    |         access collection                  |
      |                                    |         "subscription_plans" or it does    |
      |                                    |         not exist. Queried in root.        |
      |                                    |       extensions:                          |
      |                                    |         code: FORBIDDEN                    |
      | method: DELETE                     | code: 400                                  |+
      | path: /items/subscription_plans/10 | body:                                      |
      |                                    |   errors:                                  |
      |                                    |     - message: >-                          |
      |                                    |         Invalid payload. Plan "direct"     |
      |                                    |         cannot be deleted, archive it      |
      |                                    |         instead.                           |
      |                                    |       extensions:                          |
      |                                    |         code: INVALID_PAYLOAD              |
      | as: anonymous                      | code: 403                                  |+
      | method: PATCH                      | body:                                      |
      | path: /items/subscription_plans/10 |   errors:                                  |
      | payload:                           |     - message: >-                          |
      |   status: archived                 |         You don't have permission to       |
      |                                    |         access collection                  |
      |                                    |         "subscription_plans" or it does    |
      |                                    |         not exist. Queried in root.        |
      |                                    |       extensions:                          |
      |                                    |         code: FORBIDDEN                    |
      | method: PATCH                      | code: 400                                  |+
      | path: /items/subscription_plans/10 | body:                                      |
      | payload:                           |   errors:                                  |
      |   status: archived                 |     - message: >-                          |
      |                                    |         Invalid payload. A plan is         |
      |                                    |         archived through "POST             |
      |                                    |         /subscriptions/plans/:id/archive". |
      |                                    |       extensions:                          |
      |                                    |         code: INVALID_PAYLOAD              |
      | method: PATCH                      | code: 400                                  |+
      | path: /items/subscription_plans/11 | body:                                      |
      | payload:                           |   errors:                                  |
      |   status: active                   |     - message: >-                          |
      |                                    |         Invalid payload. Plan "gone" is    |
      |                                    |         archived, its status cannot        |
      |                                    |         change.                            |
      |                                    |       extensions:                          |
      |                                    |         code: INVALID_PAYLOAD              |
      | method: DELETE                     | code: 400                                  |+
      | path: "/items/subscription_plan_\  | body:                                      |
      |   references/10"                   |   errors:                                  |
      |                                    |     - message: >-                          |
      |                                    |         Cannot delete                      |
      |                                    |         "subscription_plan_references:10": |
      |                                    |         it is still referenced by          |
      |                                    |         collection "subscriptions".        |
      |                                    |       extensions:                          |
      |                                    |         code: INVALID_FOREIGN_KEY          |
      | method: PATCH                      | code: 400                                  |+
      | path: "/items/subscription_plan_\  | body:                                      |
      |   references/10"                   |   errors:                                  |
      | payload:                           |     - message: >-                          |
      |   reference: other                 |         Invalid payload. Plan reference    |
      |                                    |         "direct-plan" is used by a         |
      |                                    |         subscription, it cannot change.    |
      |                                    |       extensions:                          |
      |                                    |         code: INVALID_PAYLOAD              |
      | method: PATCH                      | code: 400                                  |+
      | path: /items/subscriptions/900     | body:                                      |
      | payload:                           |   errors:                                  |
      |   status: canceled                 |     - message: >-                          |
      |                                    |         Invalid payload. "status" and      |
      |                                    |         "cancel_at_period_end" of a        |
      |                                    |         subscription follow its provider.  |
      |                                    |       extensions:                          |
      |                                    |         code: INVALID_PAYLOAD              |
      | as: anonymous                      | code: 403                                  |+
      | method: POST                       | body:                                      |
      | path: /items/subscription_events   |   errors:                                  |
      | payload:                           |     - message: >-                          |
      |   source: sync                     |         You don't have permission to       |
      |                                    |         perform "create" for collection    |
      |                                    |         "subscription_events" or it does   |
      |                                    |         not exist.                         |
      |                                    |       extensions:                          |
      |                                    |         code: FORBIDDEN                    |
      | method: POST                       | code: 400                                  |+
      | path: /items/subscription_events   | body:                                      |
      | payload:                           |   errors:                                  |
      |   source: sync                     |     - message: >-                          |
      |                                    |         Invalid payload.                   |
      |                                    |         "subscription_events" only records |
      |                                    |         what the subscriptions bundle did. |
      |                                    |       extensions:                          |
      |                                    |         code: INVALID_PAYLOAD              |
      | method: GET                        | code: 200                                  |+
      | path: /presets                     | body:                                      |
      | query:                             |   data:                                    |
      |   filter[bookmark][_eq]: >-        |     - bookmark: Parked syncs               |
      |     Parked syncs                   |       collection: subscription_sync_queue  |
