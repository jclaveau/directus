Feature: A user checks out a plan, paying its price or more

  - A request authenticates as the admin unless its `as` names a token;
    `as: public` sends none.
  - The instance loads the real `@scalabus/subscriptions` bundle, and its Mollie
    and Stripe clients call fake ones, answering what `holds` says.
  - The fake Stripe answers the checkout session of subscription 141 as
    `cs_checkout_141` at `<stripe_page>141`, `<stripe_page>` being
    `https://checkout.stripe.com/c/pay/cs_checkout_`. The fake Mollie answers
    its customer as `cst_checkout_141` and its payment as `tr_checkout_141` at
    `<mollie_page>141`, `<mollie_page>` being
    `https://www.mollie.com/checkout/tr_checkout_`.
  - The instance's `SUBSCRIPTIONS_CHECKOUT_URL_ALLOW_LIST` is
    `https://shop.example.com/ok`.
  - A `<name>` stands for one value, the same in the tables and the requests; a
    `<name>` first met in a response takes the value found there.
  - `received these writes` reads what the providers received since it last read.
    A Stripe write's `body` is the YAML its form fields decode to, a Mollie
    write's its JSON.
  - A `Scenario Outline` runs once per provider of its `Examples`; a table with a
    `provider` column keeps that provider's rows.

  Scenario Outline: a <provider> user checks out a plan at its price
    Given the rows of directus_policies:
      | id           | name          |
      | <policy<id>> | Checkout <id> |
    And the rows of directus_users:
      | id           | email                  | token            |
      | <payer_<id>> | payer-<id>@example.com | payer-<id>-token |
    And the rows of subscription_plans:
      | id   | code    | name | policy       | amount | currency | interval     | status |
      | <id> | pro<id> | Pro  | <policy<id>> | 9.90   | EUR      | {"months":1} | active |
    When these requests get these responses:
      | request                         | response                     |
      | as: payer-<id>-token            | code: 200                    |+
      | method: POST                    | body:                        |
      | path: /subscriptions/checkout   |   data:                      |
      | payload:                        |     subscription: <checkout> |
      |   plan: pro<id>                 |     url: <page><checkout>    |
      |   provider: <provider>          |                              |
      |   redirect_url: >-              |                              |
      |     https://shop.example.com/ok |                              |
    Then the providers eventually received these writes:
      | provider | write                                      |
      | stripe   | method: POST                               |+
      |          | path: /v1/checkout/sessions                |
      |          | body:                                      |
      |          |   mode: subscription                       |
      |          |   customer_email: payer-<id>@example.com   |
      |          |   line_items:                              |
      |          |     - quantity: 1                          |
      |          |       price_data:                          |
      |          |         currency: eur                      |
      |          |         unit_amount: 990                   |
      |          |         recurring:                         |
      |          |           interval: month                  |
      |          |           interval_count: 1                |
      |          |         product_data:                      |
      |          |           name: Pro                        |
      |          |   subscription_data:                       |
      |          |     metadata:                              |
      |          |       directus_subscription: <checkout>    |
      |          |   metadata:                                |
      |          |     directus_subscription: <checkout>      |
      |          |   success_url: https://shop.example.com/ok |
      |          |   cancel_url: https://shop.example.com/ok  |
      | mollie   | method: POST                               |+
      |          | path: /v2/customers                        |
      |          | body:                                      |
      |          |   email: payer-<id>@example.com            |
      |          |   metadata:                                |
      |          |     directus_subscription: "<checkout>"    |
      | mollie   | method: POST                               |+
      |          | path: /v2/payments                         |
      |          | body:                                      |
      |          |   amount:                                  |
      |          |     currency: EUR                          |
      |          |     value: "9.90"                          |
      |          |   customerId: cst_checkout_<checkout>      |
      |          |   sequenceType: first                      |
      |          |   description: Subscription <checkout>     |
      |          |   redirectUrl: https://shop.example.com/ok |
      |          |   metadata:                                |
      |          |     directus_subscription: "<checkout>"    |
    And these requests get these responses:
      | request                                 | response                   |
      | method: GET                             | code: 200                  |+
      | path: /items/subscriptions/<checkout>   | body:                      |
      | query:                                  |   data:                    |
      |   fields: >-                            |     plan: <id>             |
      |     plan,provider,status,payer,         |     provider: <provider>   |
      |     custom_amount,billing_mismatch      |     status: pending        |
      |                                         |     payer: <payer_<id>>    |
      |                                         |     custom_amount: null    |
      |                                         |     billing_mismatch: null |
      | method: GET                             | code: 200                  |+
      | path: /items/subscription_managers      | body:                      |
      | query:                                  |   data:                    |
      |   fields: user                          |     - user: <payer_<id>>   |
      |   filter[subscription][_eq]: <checkout> |                            |
      | method: GET                             | code: 200                  |+
      | path: /items/subscription_beneficiaries | body:                      |
      | query:                                  |   data:                    |
      |   fields: user                          |     - user: <payer_<id>>   |
      |   filter[subscription][_eq]: <checkout> |                            |

    Examples:
      | provider | id  | page          |
      | mollie   | 141 | <mollie_page> |
      | stripe   | 142 | <stripe_page> |

  Scenario Outline: a <provider> user pays above the plan's price, kept as custom_amount
    Given the rows of directus_policies:
      | id           | name          |
      | <policy<id>> | Checkout <id> |
    And the rows of directus_users:
      | id           | email                  | token            |
      | <payer_<id>> | payer-<id>@example.com | payer-<id>-token |
    And the rows of subscription_plans:
      | id   | code    | name | policy       | amount | currency | interval     | status |
      | <id> | pro<id> | Pro  | <policy<id>> | 9.90   | EUR      | {"months":1} | active |
    When these requests get these responses:
      | request                         | response                     |
      | as: payer-<id>-token            | code: 200                    |+
      | method: POST                    | body:                        |
      | path: /subscriptions/checkout   |   data:                      |
      | payload:                        |     subscription: <checkout> |
      |   plan: pro<id>                 |     url: <page><checkout>    |
      |   provider: <provider>          |                              |
      |   custom_amount: "14.90"        |                              |
      |   redirect_url: >-              |                              |
      |     https://shop.example.com/ok |                              |
    Then the providers eventually received these writes:
      | provider | write                                      |
      | stripe   | method: POST                               |+
      |          | path: /v1/checkout/sessions                |
      |          | body:                                      |
      |          |   mode: subscription                       |
      |          |   customer_email: payer-<id>@example.com   |
      |          |   line_items:                              |
      |          |     - quantity: 1                          |
      |          |       price_data:                          |
      |          |         currency: eur                      |
      |          |         unit_amount: 1490                  |
      |          |         recurring:                         |
      |          |           interval: month                  |
      |          |           interval_count: 1                |
      |          |         product_data:                      |
      |          |           name: Pro                        |
      |          |   subscription_data:                       |
      |          |     metadata:                              |
      |          |       directus_subscription: <checkout>    |
      |          |   metadata:                                |
      |          |     directus_subscription: <checkout>      |
      |          |   success_url: https://shop.example.com/ok |
      |          |   cancel_url: https://shop.example.com/ok  |
      | mollie   | method: POST                               |+
      |          | path: /v2/customers                        |
      |          | body:                                      |
      |          |   email: payer-<id>@example.com            |
      |          |   metadata:                                |
      |          |     directus_subscription: "<checkout>"    |
      | mollie   | method: POST                               |+
      |          | path: /v2/payments                         |
      |          | body:                                      |
      |          |   amount:                                  |
      |          |     currency: EUR                          |
      |          |     value: "14.90"                         |
      |          |   customerId: cst_checkout_<checkout>      |
      |          |   sequenceType: first                      |
      |          |   description: Subscription <checkout>     |
      |          |   redirectUrl: https://shop.example.com/ok |
      |          |   metadata:                                |
      |          |     directus_subscription: "<checkout>"    |
    And these requests get these responses:
      | request                               | response                   |
      | method: GET                           | code: 200                  |+
      | path: /items/subscriptions/<checkout> | body:                      |
      | query:                                |   data:                    |
      |   fields: payer,custom_amount         |     payer: <payer_<id>>    |
      |                                       |     custom_amount: "14.90" |

    Examples:
      | provider | id  | page          |
      | mollie   | 143 | <mollie_page> |
      | stripe   | 144 | <stripe_page> |

  Scenario: a custom_amount equal to the plan's price is stored as none
    Given the rows of directus_policies:
      | id          | name         |
      | <policy145> | Checkout 145 |
    And the rows of directus_users:
      | id          | email                 | token           |
      | <payer_145> | payer-145@example.com | payer-145-token |
    And the rows of subscription_plans:
      | id  | code   | name | policy      | amount | currency | interval     | status |
      | 145 | pro145 | Pro  | <policy145> | 9.90   | EUR      | {"months":1} | active |
    When these requests get these responses:
      | request                         | response                      |
      | as: payer-145-token             | code: 200                     |+
      | method: POST                    | body:                         |
      | path: /subscriptions/checkout   |   data:                       |
      | payload:                        |     subscription: <checkout>  |
      |   plan: pro145                  |     url: >-                   |
      |   provider: stripe              |       <stripe_page><checkout> |
      |   custom_amount: "9.90"         |                               |
      |   redirect_url: >-              |                               |
      |     https://shop.example.com/ok |                               |
    Then these requests get these responses:
      | request                               | response                |
      | method: GET                           | code: 200               |+
      | path: /items/subscriptions/<checkout> | body:                   |
      | query:                                |   data:                 |
      |   fields: custom_amount               |     custom_amount: null |

  Scenario: a checkout is refused before anything reaches a provider
    Given the rows of directus_policies:
      | id          | name         |
      | <policy146> | Checkout 146 |
    And the rows of directus_users:
      | id          | email                 | token           |
      | <payer_146> | payer-146@example.com | payer-146-token |
    And the rows of subscription_plans:
      | id  | code   | name | policy      | amount | currency | interval     | status   |
      | 146 | pro146 | Pro  | <policy146> | 9.90   | EUR      | {"months":1} | active   |
      | 147 | old147 | Old  | <policy146> | 9.90   | EUR      | {"months":1} | archived |
    Then these requests get these responses:
      | request                         | response                                   |
      | as: public                      | code: 403                                  |+
      | method: POST                    | body:                                      |
      | path: /subscriptions/checkout   |   errors:                                  |
      | payload:                        |     - message: >-                          |
      |   plan: pro146                  |         You don't have permission to       |
      |   provider: stripe              |         access this.                       |
      |   redirect_url: >-              |       extensions:                          |
      |     https://shop.example.com/ok |         code: FORBIDDEN                    |
      | as: payer-146-token             | code: 400                                  |+
      | method: POST                    | body:                                      |
      | path: /subscriptions/checkout   |   errors:                                  |
      | payload:                        |     - message: >-                          |
      |   plan: pro146                  |         Invalid payload. "custom_amount"   |
      |   provider: stripe              |         must be at least "9.90", got       |
      |   custom_amount: "5.00"         |         "5.00".                            |
      |   redirect_url: >-              |       extensions:                          |
      |     https://shop.example.com/ok |         code: INVALID_PAYLOAD              |
      | as: payer-146-token             | code: 400                                  |+
      | method: POST                    | body:                                      |
      | path: /subscriptions/checkout   |   errors:                                  |
      | payload:                        |     - message: >-                          |
      |   plan: pro146                  |         Invalid payload. "custom_amount"   |
      |   provider: stripe              |         must be an amount like "14.90",    |
      |   custom_amount: "9.999"        |         got "9.999".                       |
      |   redirect_url: >-              |       extensions:                          |
      |     https://shop.example.com/ok |         code: INVALID_PAYLOAD              |
      | as: payer-146-token             | code: 400                                  |+
      | method: POST                    | body:                                      |
      | path: /subscriptions/checkout   |   errors:                                  |
      | payload:                        |     - message: >-                          |
      |   plan: pro146                  |         Invalid payload. "custom_amount"   |
      |   provider: stripe              |         must be an amount like "14.90",    |
      |   custom_amount: 14.9           |         got 14.9.                          |
      |   redirect_url: >-              |       extensions:                          |
      |     https://shop.example.com/ok |         code: INVALID_PAYLOAD              |
      | as: payer-146-token             | code: 400                                  |+
      | method: POST                    | body:                                      |
      | path: /subscriptions/checkout   |   errors:                                  |
      | payload:                        |     - message: >-                          |
      |   plan: none-146                |         Invalid payload. Plan "none-146"   |
      |   provider: stripe              |         does not exist.                    |
      |   redirect_url: >-              |       extensions:                          |
      |     https://shop.example.com/ok |         code: INVALID_PAYLOAD              |
      | as: payer-146-token             | code: 400                                  |+
      | method: POST                    | body:                                      |
      | path: /subscriptions/checkout   |   errors:                                  |
      | payload:                        |     - message: >-                          |
      |   plan: old147                  |         Invalid payload. Plan "old147"     |
      |   provider: stripe              |         is archived, it sells no more.     |
      |   redirect_url: >-              |       extensions:                          |
      |     https://shop.example.com/ok |         code: INVALID_PAYLOAD              |
      | as: payer-146-token             | code: 400                                  |+
      | method: POST                    | body:                                      |
      | path: /subscriptions/checkout   |   errors:                                  |
      | payload:                        |     - message: >-                          |
      |   plan: pro146                  |         Invalid payload. "provider" must   |
      |   provider: paypal              |         be one of ["mollie","stripe"],     |
      |   redirect_url: >-              |         got "paypal".                      |
      |     https://shop.example.com/ok |       extensions:                          |
      |                                 |         code: INVALID_PAYLOAD              |
      | as: payer-146-token             | code: 400                                  |+
      | method: POST                    | body:                                      |
      | path: /subscriptions/checkout   |   errors:                                  |
      | payload:                        |     - message: >-                          |
      |   plan: pro146                  |         Invalid payload. URL               |
      |   provider: stripe              |         "https://evil.example.com/" can't  |
      |   redirect_url: >-              |         be used to return from a checkout. |
      |     https://evil.example.com/   |       extensions:                          |
      |                                 |         code: INVALID_PAYLOAD              |
    And the providers received no write
    And these requests get these responses:
      | request                           | response   |
      | method: GET                       | code: 200  |+
      | path: /items/subscriptions        | body:      |
      | query:                            |   data: [] |
      |   filter[payer][_eq]: <payer_146> |            |

  Scenario: a second checkout of the same plan reuses the pending subscription
    Given the rows of directus_policies:
      | id          | name         |
      | <policy148> | Checkout 148 |
    And the rows of directus_users:
      | id          | email                 | token           |
      | <payer_148> | payer-148@example.com | payer-148-token |
    And the rows of subscription_plans:
      | id  | code   | name | policy      | amount | currency | interval     | status |
      | 148 | pro148 | Pro  | <policy148> | 9.90   | EUR      | {"months":1} | active |
    When these requests get these responses:
      | request                         | response                      |
      | as: payer-148-token             | code: 200                     |+
      | method: POST                    | body:                         |
      | path: /subscriptions/checkout   |   data:                       |
      | payload:                        |     subscription: <checkout>  |
      |   plan: pro148                  |     url: >-                   |
      |   provider: stripe              |       <stripe_page><checkout> |
      |   redirect_url: >-              |                               |
      |     https://shop.example.com/ok |                               |
      | as: payer-148-token             | code: 200                     |+
      | method: POST                    | body:                         |
      | path: /subscriptions/checkout   |   data:                       |
      | payload:                        |     subscription: <checkout>  |
      |   plan: pro148                  |     url: >-                   |
      |   provider: stripe              |       <stripe_page><checkout> |
      |   custom_amount: "12.00"        |                               |
      |   redirect_url: >-              |                               |
      |     https://shop.example.com/ok |                               |
    Then these requests get these responses:
      | request                           | response                     |
      | method: GET                       | code: 200                    |+
      | path: /items/subscriptions        | body:                        |
      | query:                            |   data:                      |
      |   fields: id,custom_amount        |     - id: <checkout>         |
      |   filter[payer][_eq]: <payer_148> |       custom_amount: "12.00" |

  Scenario: a paid Mollie first payment starts the subscription at the amount sold
    Given the rows of directus_policies:
      | id          | name         |
      | <policy149> | Checkout 149 |
    And the rows of directus_users:
      | id          | email                 | token           |
      | <payer_149> | payer-149@example.com | payer-149-token |
    And the rows of subscription_plans:
      | id  | code   | name | policy      | amount | currency | interval     | status |
      | 149 | pro149 | Pro  | <policy149> | 9.90   | EUR      | {"months":1} | active |
    And these requests get these responses:
      | request                         | response                      |
      | as: payer-149-token             | code: 200                     |+
      | method: POST                    | body:                         |
      | path: /subscriptions/checkout   |   data:                       |
      | payload:                        |     subscription: <checkout>  |
      |   plan: pro149                  |     url: >-                   |
      |   provider: mollie              |       <mollie_page><checkout> |
      |   custom_amount: "14.90"        |                               |
      |   redirect_url: >-              |                               |
      |     https://shop.example.com/ok |                               |
    And Mollie holds this first payment:
      | column                | value                   |
      | payment               | tr_checkout_<checkout>  |
      | customer              | cst_checkout_<checkout> |
      | mandate               | mdt_checkout_<checkout> |
      | directus_subscription | <checkout>              |
      | status                | paid                    |
      | paid_at               | 2099-01-01              |
    When Mollie sends these events:
      | type         | entity                 |
      | payment.paid | tr_checkout_<checkout> |
    Then Mollie eventually received this subscription for cst_checkout_<checkout>:
      | field       | value                                  |
      | amount      | {"currency":"EUR","value":"14.90"}     |
      | interval    | 1 month                                |
      | description | Subscription <checkout>                |
      | mandateId   | mdt_checkout_<checkout>                |
      | startDate   | 2099-02-01                             |
      | metadata    | {"directus_subscription":"<checkout>"} |
    And this access is eventually stored:
      | user        | policy      | managed_by              |
      | <payer_149> | <policy149> | @scalabus/subscriptions |
    And these requests get these responses:
      | request                               | response                       |
      | method: GET                           | code: 200                      |+
      | path: /items/subscriptions/<checkout> | body:                          |
      | query:                                |   data:                        |
      |   fields: >-                          |     status: active             |
      |     status,current_period_end,        |     current_period_end: >-     |
      |     billing_mismatch                  |       2099-02-01T00:00:00.000Z |
      |                                       |     billing_mismatch: null     |

  Scenario: a completed Stripe checkout grants the access at the amount sold
    Given the rows of directus_policies:
      | id          | name         |
      | <policy150> | Checkout 150 |
    And the rows of directus_users:
      | id          | email                 | token           |
      | <payer_150> | payer-150@example.com | payer-150-token |
    And the rows of subscription_plans:
      | id  | code   | name | policy      | amount | currency | interval     | status |
      | 150 | pro150 | Pro  | <policy150> | 9.90   | EUR      | {"months":1} | active |
    And these requests get these responses:
      | request                         | response                      |
      | as: payer-150-token             | code: 200                     |+
      | method: POST                    | body:                         |
      | path: /subscriptions/checkout   |   data:                       |
      | payload:                        |     subscription: <checkout>  |
      |   plan: pro150                  |     url: >-                   |
      |   provider: stripe              |       <stripe_page><checkout> |
      |   custom_amount: "14.90"        |                               |
      |   redirect_url: >-              |                               |
      |     https://shop.example.com/ok |                               |
    And Stripe holds this subscription:
      | column                | value            |
      | subscription          | sub_checkout_150 |
      | customer              | cus_checkout_150 |
      | directus_subscription | <checkout>       |
      | status                | active           |
      | unit_amount           | 1490             |
    When Stripe sends these events:
      | type                          | subscription     |
      | customer.subscription.created | sub_checkout_150 |
    Then this access is eventually stored:
      | user        | policy      | managed_by              |
      | <payer_150> | <policy150> | @scalabus/subscriptions |
    And subscription sub_checkout_150 is eventually stored:
      | status | cancel_at_period_end |
      | active | false                |
    And these requests get these responses:
      | request                               | response                   |
      | method: GET                           | code: 200                  |+
      | path: /items/subscriptions/<checkout> | body:                      |
      | query:                                |   data:                    |
      |   fields: billing_mismatch            |     billing_mismatch: null |

  Scenario Outline: an abandoned <provider> checkout expires its pending subscription
    Given the rows of directus_policies:
      | id           | name          |
      | <policy<id>> | Checkout <id> |
    And the rows of directus_users:
      | id           | email                  | token            |
      | <payer_<id>> | payer-<id>@example.com | payer-<id>-token |
    And the rows of subscription_plans:
      | id   | code    | name | policy       | amount | currency | interval     | status |
      | <id> | pro<id> | Pro  | <policy<id>> | 9.90   | EUR      | {"months":1} | active |
    And these requests get these responses:
      | request                         | response                     |
      | as: payer-<id>-token            | code: 200                    |+
      | method: POST                    | body:                        |
      | path: /subscriptions/checkout   |   data:                      |
      | payload:                        |     subscription: <checkout> |
      |   plan: pro<id>                 |     url: <page><checkout>    |
      |   provider: <provider>          |                              |
      |   redirect_url: >-              |                              |
      |     https://shop.example.com/ok |                              |
    When the provider sends these events:
      | provider | type                     | entity                 |
      | mollie   | payment.expired          | tr_checkout_<checkout> |
      | stripe   | checkout.session.expired | cs_checkout_<checkout> |
    Then the sync queue eventually holds no row for this resource:
      | provider | resource_id            |
      | mollie   | tr_checkout_<checkout> |
      | stripe   | cs_checkout_<checkout> |
    And these requests get these responses:
      | request                               | response            |
      | method: GET                           | code: 200           |+
      | path: /items/subscriptions/<checkout> | body:               |
      | query:                                |   data:             |
      |   fields: status                      |     status: expired |
    And this user eventually holds no access:
      | user         |
      | <payer_<id>> |

    Examples:
      | provider | id  | page          |
      | mollie   | 151 | <mollie_page> |
      | stripe   | 152 | <stripe_page> |

  Scenario: a payer's deleted account leaves the subscription with no payer
    Given the rows of directus_policies:
      | id          | name         |
      | <policy153> | Checkout 153 |
    And the rows of directus_users:
      | id          | email                 | token           |
      | <payer_153> | payer-153@example.com | payer-153-token |
      | <co_153>    | co-153@example.com    | co-153-token    |
    And the rows of subscription_plans:
      | id  | code   | name | policy      | amount | currency | interval     | status |
      | 153 | pro153 | Pro  | <policy153> | 9.90   | EUR      | {"months":1} | active |
    And the rows of subscriptions:
      | id  | plan | provider | status | payer       | custom_amount |
      | 153 | 153  | mollie   | active | <payer_153> | 14.90         |
    And the rows of subscription_managers:
      | subscription | user        |
      | 153          | <payer_153> |
      | 153          | <co_153>    |
    When these requests get these responses:
      | request                  | response  |
      | method: DELETE           | code: 204 |+
      | path: /users/<payer_153> |           |
    Then these requests get these responses:
      | request                        | response                   |
      | method: GET                    | code: 200                  |+
      | path: /items/subscriptions/153 | body:                      |
      | query:                         |   data:                    |
      |   fields: payer,custom_amount  |     payer: null            |
      |                                |     custom_amount: "14.90" |
