Feature: The examples' fake providers take a payment in the preview

  - A request authenticates as the admin unless its `as` names a token;
    `as: public` sends none.
  - The instance loads `@scalabus/subscriptions` and `@scalabus/subscriptions-examples`,
    with `SUBSCRIPTIONS_EXAMPLES_FAKE_PROVIDERS` set to `true`, the way the preview
    boots them: its Mollie and Stripe clients call the examples' fake providers,
    which hold what a checkout created, never what a scenario says.
  - A checkout's `url` is the fake's page `<public_url><pay><payment>`, `<pay>`
    being `/subscriptions-examples/pay/` and `<payment>` the Mollie payment
    `tr_examples_<checkout>` or the Stripe checkout session
    `cs_examples_<checkout>`. The page's form posts the `outcome` picked; the
    fake then sends the provider's webhook (Stripe's signed with the instance's
    own webhook secret) and redirects to the checkout's `redirect_url`.
  - The instance's `SUBSCRIPTIONS_CHECKOUT_URL_ALLOW_LIST` is
    `https://shop.example.com/ok`.
  - A `<name>` stands for one value, the same in the tables and the requests; a
    `<name>` first met in a response takes the value found there.
  - `<user_N>` is the user `user-N@example.com` with the token `user-N-token`.
  - A `Scenario Outline` runs once per provider of its `Examples`.

  Scenario Outline: a <provider> payment made on the fake's page starts the subscription
    Given the rows of directus_policies:
      | id           | name     |
      | <policy<id>> | Pro <id> |
    And the rows of directus_users:
      | id          | email                 | token           |
      | <user_<id>> | user-<id>@example.com | user-<id>-token |
    And the rows of subscription_plans:
      | id   | code    | name | policy       | amount | currency | interval     | status |
      | <id> | pro<id> | Pro  | <policy<id>> | 10     | EUR      | {"months":1} | active |
    Then these requests get these responses:
      | request                         | response                            |
      | as: user-<id>-token             | code: 200                           |+
      | method: POST                    | body:                               |
      | path: /subscriptions/checkout   |   data:                             |
      | payload:                        |     subscription: <checkout>        |
      |   plan: pro<id>                 |     url: <public_url><pay><payment> |
      |   provider: <provider>          |                                     |
      |   redirect_url: >-              |                                     |
      |     https://shop.example.com/ok |                                     |
      | as: public                      | code: 302                           |+
      | method: POST                    | headers:                            |
      | path: <pay><payment>            |   location: >-                      |
      | payload:                        |     https://shop.example.com/ok     |
      |   outcome: paid                 |                                     |
    And this access is eventually stored:
      | user        | policy       | managed_by              |
      | <user_<id>> | <policy<id>> | @scalabus/subscriptions |
    And these requests get these responses:
      | request                   | response                          |
      | as: user-<id>-token       | code: 200                         |+
      | method: GET               | body:                             |
      | path: /subscriptions/mine |   data:                           |
      |                           |     - id: <checkout>              |
      |                           |       plan:                       |
      |                           |         code: pro<id>             |
      |                           |         name: Pro                 |
      |                           |       provider: <provider>        |
      |                           |       status: active              |
      |                           |       current_period_end: >-      |
      |                           |         2099-02-01T00:00:00.000Z  |
      |                           |       cancel_at_period_end: false |
      |                           |       roles:                      |
      |                           |         - manager                 |
      |                           |         - beneficiary             |
      |                           |       amount: "10.00"             |
      |                           |       currency: EUR               |
      |                           |       beneficiaries:              |
      |                           |         - user-<id>@example.com   |

    Examples:
      | provider | id  |
      | mollie   | 211 |
      | stripe   | 212 |

  Scenario Outline: a <provider> payment <outcome> on the fake's page expires it
    Given the rows of directus_policies:
      | id           | name     |
      | <policy<id>> | Pro <id> |
    And the rows of directus_users:
      | id          | email                 | token           |
      | <user_<id>> | user-<id>@example.com | user-<id>-token |
    And the rows of subscription_plans:
      | id   | code    | name | policy       | amount | currency | interval     | status |
      | <id> | pro<id> | Pro  | <policy<id>> | 10     | EUR      | {"months":1} | active |
    Then these requests get these responses:
      | request                         | response                            |
      | as: user-<id>-token             | code: 200                           |+
      | method: POST                    | body:                               |
      | path: /subscriptions/checkout   |   data:                             |
      | payload:                        |     subscription: <checkout>        |
      |   plan: pro<id>                 |     url: <public_url><pay><payment> |
      |   provider: <provider>          |                                     |
      |   redirect_url: >-              |                                     |
      |     https://shop.example.com/ok |                                     |
      | as: public                      | code: 302                           |+
      | method: POST                    | headers:                            |
      | path: <pay><payment>            |   location: >-                      |
      | payload:                        |     https://shop.example.com/ok     |
      |   outcome: <outcome>            |                                     |
    And these requests get these responses:
      | request                               | response            |
      | method: GET                           | code: 200           |+
      | path: /items/subscriptions/<checkout> | body:               |
      | query:                                |   data:             |
      |   fields: status                      |     status: expired |
    And this user eventually holds no access:
      | user        |
      | <user_<id>> |

    Examples:
      | provider | id  | outcome  |
      | mollie   | 213 | failed   |
      | mollie   | 214 | canceled |
      | stripe   | 215 | canceled |

  Scenario: the fake's page refuses an unknown payment or outcome
    Given the rows of directus_users:
      | id         | email                | token          |
      | <user_216> | user-216@example.com | user-216-token |
    And the rows of subscription_plans:
      | id  | code   | name | amount | currency | interval     | status |
      | 216 | pro216 | Pro  | 10     | EUR      | {"months":1} | active |
    Then these requests get these responses:
      | request                         | response                                      |
      | as: public                      | code: 404                                     |+
      | method: POST                    | body:                                         |
      | path: <pay>tr_unknown_216       |   errors:                                     |
      | payload:                        |     - message: >-                             |
      |   outcome: paid                 |         The fake providers hold no            |
      |                                 |         payment "tr_unknown_216".             |
      |                                 |       extensions:                             |
      |                                 |         code: ROUTE_NOT_FOUND                 |
      | as: user-216-token              | code: 200                                     |+
      | method: POST                    | body:                                         |
      | path: /subscriptions/checkout   |   data:                                       |
      | payload:                        |     subscription: <checkout>                  |
      |   plan: pro216                  |     url: <public_url><pay><payment>           |
      |   provider: mollie              |                                               |
      |   redirect_url: >-              |                                               |
      |     https://shop.example.com/ok |                                               |
      | as: public                      | code: 400                                     |+
      | method: POST                    | body:                                         |
      | path: <pay><payment>            |   errors:                                     |
      | payload:                        |     - message: >-                             |
      |   outcome: refunded             |         Invalid payload. "outcome" is "paid", |
      |                                 |         "failed" or "canceled", got           |
      |                                 |         "refunded".                           |
      |                                 |       extensions:                             |
      |                                 |         code: INVALID_PAYLOAD                 |

  Scenario: the examples serve no fake page unless told to
    Given an instance loading both extensions, with no fake providers
    Then these requests get these responses:
      | request                    | response                                   |
      | as: public                 | code: 404                                  |+
      | method: POST               | body:                                      |
      | path: <pay>tr_examples_217 |   errors:                                  |
      | payload:                   |     - message: >-                          |
      |   outcome: paid            |         Route /subscriptions-examples/pay/ |
      |                            |         tr_examples_217 doesn't exist.     |
      |                            |       extensions:                          |
      |                            |         code: ROUTE_NOT_FOUND              |

  Scenario: the fake providers refuse to start next to a real provider key
    When the CLI runs start with these variables:
      | variable                              | value       |
      | EXTENSIONS_MUST_LOAD                  | true        |
      | SUBSCRIPTIONS_EXAMPLES_FAKE_PROVIDERS | true        |
      | SUBSCRIPTIONS_STRIPE_SECRET_KEY       | sk_live_218 |
      | SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET   | whsec_218   |
    Then the CLI exited with 1, having logged:
      """
      "SUBSCRIPTIONS_EXAMPLES_FAKE_PROVIDERS" fakes Stripe and Mollie, it refuses
      to start next to the live key "SUBSCRIPTIONS_STRIPE_SECRET_KEY"
      """
