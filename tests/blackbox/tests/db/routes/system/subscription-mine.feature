Feature: A user lists the subscriptions it manages or benefits from

  - A request authenticates as the admin unless its `as` names a token;
    `as: public` sends none.
  - The instance loads the real `@scalabus/subscriptions` bundle.
  - A subscription's `amount` is its `custom_amount`, or its plan's `amount`
    when it has none; only its managers see it, with its beneficiaries' emails.
  - A subscription never paid, `pending` or `expired`, is not listed.
  - A row of `subscriptions` stating no `date_created` nor `date_updated` is
    seeded with the time it is written for both.
  - A `<name>` stands for one uuid, the same in the tables and the requests.

  Scenario: a manager sees its subscription, its price and its beneficiaries
    Given the rows of directus_policies:
      | id          | name     |
      | <policy181> | Mine 181 |
    And the rows of directus_users:
      | id            | email                   | token           | status  |
      | <payer_181>   | payer-181@example.com   | payer-181-token | active  |
      | <friend_181>  | friend-181@example.com  |                 | active  |
      | <invited_181> | invited-181@example.com |                 | invited |
    And the rows of subscription_plans:
      | id  | code   | name | policy      | amount | currency | interval     | status |
      | 181 | pro181 | Pro  | <policy181> | 10     | EUR      | {"months":1} | active |
    And the rows of subscriptions:
      | id  | plan | provider | status | current_period_end | custom_amount |
      | 181 | 181  | stripe   | active | 2099-02-01         | 14.90         |
    And the rows of subscription_managers:
      | subscription | user        |
      | 181          | <payer_181> |
    And the rows of subscription_beneficiaries:
      | subscription | user          |
      | 181          | <payer_181>   |
      | 181          | <friend_181>  |
      | 181          | <invited_181> |
    Then these requests get these responses:
      | request                   | response                          |
      | as: payer-181-token       | code: 200                         |+
      | method: GET               | body:                             |
      | path: /subscriptions/mine |   data:                           |
      |                           |     - id: 181                     |
      |                           |       plan:                       |
      |                           |         code: pro181              |
      |                           |         name: Pro                 |
      |                           |       provider: stripe            |
      |                           |       status: active              |
      |                           |       current_period_end: >-      |
      |                           |         2099-02-01T00:00:00.000Z  |
      |                           |       cancel_at_period_end: false |
      |                           |       roles:                      |
      |                           |         - manager                 |
      |                           |         - beneficiary             |
      |                           |       amount: "14.90"             |
      |                           |       currency: EUR               |
      |                           |       beneficiaries:              |
      |                           |         - friend-181@example.com  |
      |                           |         - invited-181@example.com |
      |                           |         - payer-181@example.com   |

  Scenario: a manager of a subscription sold at its plan's price sees that price
    Given the rows of directus_policies:
      | id          | name     |
      | <policy182> | Mine 182 |
    And the rows of directus_users:
      | id          | email                 | token           |
      | <payer_182> | payer-182@example.com | payer-182-token |
    And the rows of subscription_plans:
      | id  | code   | name | policy      | amount | currency | interval     | status |
      | 182 | pro182 | Pro  | <policy182> | 10     | EUR      | {"months":1} | active |
    And the rows of subscriptions:
      | id  | plan | provider | status | current_period_end |
      | 182 | 182  | mollie   | active | 2099-02-01         |
    And the rows of subscription_managers:
      | subscription | user        |
      | 182          | <payer_182> |
    Then these requests get these responses:
      | request                   | response                          |
      | as: payer-182-token       | code: 200                         |+
      | method: GET               | body:                             |
      | path: /subscriptions/mine |   data:                           |
      |                           |     - id: 182                     |
      |                           |       plan:                       |
      |                           |         code: pro182              |
      |                           |         name: Pro                 |
      |                           |       provider: mollie            |
      |                           |       status: active              |
      |                           |       current_period_end: >-      |
      |                           |         2099-02-01T00:00:00.000Z  |
      |                           |       cancel_at_period_end: false |
      |                           |       roles:                      |
      |                           |         - manager                 |
      |                           |       amount: "10.00"             |
      |                           |       currency: EUR               |
      |                           |       beneficiaries: []           |

  Scenario: a beneficiary sees its subscription, not its price nor the others seated
    Given the rows of directus_policies:
      | id          | name     |
      | <policy183> | Mine 183 |
    And the rows of directus_users:
      | id           | email                  | token            |
      | <payer_183>  | payer-183@example.com  | payer-183-token  |
      | <friend_183> | friend-183@example.com | friend-183-token |
      | <other_183>  | other-183@example.com  |                  |
    And the rows of subscription_plans:
      | id  | code   | name | policy      | amount | currency | interval     | status |
      | 183 | pro183 | Pro  | <policy183> | 10     | EUR      | {"months":1} | active |
    And the rows of subscriptions:
      | id  | plan | provider | status | current_period_end | custom_amount |
      | 183 | 183  | stripe   | active | 2099-02-01         | 14.90         |
    And the rows of subscription_managers:
      | subscription | user        |
      | 183          | <payer_183> |
    And the rows of subscription_beneficiaries:
      | subscription | user         |
      | 183          | <friend_183> |
      | 183          | <other_183>  |
    Then these requests get these responses:
      | request                   | response                          |
      | as: friend-183-token      | code: 200                         |+
      | method: GET               | body:                             |
      | path: /subscriptions/mine |   data:                           |
      |                           |     - id: 183                     |
      |                           |       plan:                       |
      |                           |         code: pro183              |
      |                           |         name: Pro                 |
      |                           |       provider: stripe            |
      |                           |       status: active              |
      |                           |       current_period_end: >-      |
      |                           |         2099-02-01T00:00:00.000Z  |
      |                           |       cancel_at_period_end: false |
      |                           |       roles:                      |
      |                           |         - beneficiary             |

  Scenario: ended and cancelled subscriptions stay listed, newest first
    Given the rows of directus_policies:
      | id          | name     |
      | <policy184> | Mine 184 |
    And the rows of directus_users:
      | id         | email                | token          |
      | <user_184> | user-184@example.com | user-184-token |
    And the rows of subscription_plans:
      | id  | code   | name | policy      | amount | currency | interval     | status   |
      | 184 | pro184 | Pro  | <policy184> | 10     | EUR      | {"months":1} | archived |
    And the rows of subscriptions:
      | id  | plan | provider | status   | current_period_end | cancel_at_period_end |
      | 184 | 184  | mollie   | canceled | 2026-01-01         | true                 |
      | 185 | 184  | mollie   | active   | 2099-02-01         | true                 |
    And the rows of subscription_beneficiaries:
      | subscription | user       |
      | 184          | <user_184> |
      | 185          | <user_184> |
    Then these requests get these responses:
      | request                   | response                         |
      | as: user-184-token        | code: 200                        |+
      | method: GET               | body:                            |
      | path: /subscriptions/mine |   data:                          |
      |                           |     - id: 185                    |
      |                           |       plan:                      |
      |                           |         code: pro184             |
      |                           |         name: Pro                |
      |                           |       provider: mollie           |
      |                           |       status: active             |
      |                           |       current_period_end: >-     |
      |                           |         2099-02-01T00:00:00.000Z |
      |                           |       cancel_at_period_end: true |
      |                           |       roles:                     |
      |                           |         - beneficiary            |
      |                           |     - id: 184                    |
      |                           |       plan:                      |
      |                           |         code: pro184             |
      |                           |         name: Pro                |
      |                           |       provider: mollie           |
      |                           |       status: canceled           |
      |                           |       current_period_end: >-     |
      |                           |         2026-01-01T00:00:00.000Z |
      |                           |       cancel_at_period_end: true |
      |                           |       roles:                     |
      |                           |         - beneficiary            |

  Scenario: a user with no subscription lists none, the public is refused
    Given the rows of directus_users:
      | id         | email                | token          |
      | <user_186> | user-186@example.com | user-186-token |
    Then these requests get these responses:
      | request                   | response                             |
      | as: user-186-token        | code: 200                            |+
      | method: GET               | body:                                |
      | path: /subscriptions/mine |   data: []                           |
      | as: public                | code: 403                            |+
      | method: GET               | body:                                |
      | path: /subscriptions/mine |   errors:                            |
      |                           |     - message: >-                    |
      |                           |         You don't have permission to |
      |                           |         access this.                 |
      |                           |       extensions:                    |
      |                           |         code: FORBIDDEN              |
