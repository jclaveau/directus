Feature: A read pins every collection it embeds through a nested relation

  pin_owner is scoped by "space". pin_owned_item.owner names a pin_owner and
  pin_owned_sub_item.owned_item names a pin_owned_item; each relation names its
  o2m alias, owned_items and owned_sub_items. The read below embeds the
  sub-items two relations deep, and its entry is pinned by every collection the
  field graph reaches: a write to pin_owned_sub_item purges it. `<run>` stands
  for a value unique to the scenario, and any other `<name>` for a uuid of its
  own.

  Scenario: writing an embedded sub-item refreshes the read that carried it
    Given the rows of pin_owner:
      | id      | space |
      | <owner> | <run> |
    And the rows of pin_owned_item:
      | id     | owner   |
      | <item> | <owner> |
    And the rows of pin_owned_sub_item:
      | id        | owned_item | label  |
      | <subitem> | <item>     | before |
    And this read is cached:
      | request                             | response                   |
      | method: GET                         | code: 200                  |+
      | path: /items/pin_owner              | headers:                   |
      | query:                              |   x-cache-status: HIT      |
      |   fields:                           |   x-scoped-cache-tags:     |
      |     - '*'                           |   - pin_owned_item         |
      |     - owned_items.*                 |   - pin_owned_sub_item     |
      |     - owned_items.owned_sub_items.* |   - pin_owner:space=<run>  |
      |   filter:                           | body:                      |
      |     space:                          |   data:                    |
      |       _eq: <run>                    |   - id: <owner>            |
      |                                     |     space: <run>           |
      |                                     |     owned_items:           |
      |                                     |     - id: <item>           |
      |                                     |       owner: <owner>       |
      |                                     |       owned_sub_items:     |
      |                                     |       - id: <subitem>      |
      |                                     |         owned_item: <item> |
      |                                     |         label: before      |
    Then these requests get these responses:
      | request                                   | response                            |
      | method: PATCH                             | code: 200                           |+
      | path: /items/pin_owned_sub_item/<subitem> | headers:                            |
      | payload:                                  |   x-scoped-cache-purged-tags:       |
      |   label: after                            |   - pin_owned_sub_item              |
      |                                           |   - pin_owned_sub_item:id=<subitem> |
      |                                           | body:                               |
      |                                           |   data:                             |
      |                                           |     id: <subitem>                   |
      |                                           |     owned_item: <item>              |
      |                                           |     label: after                    |
      | method: GET                               | code: 200                           |+
      | path: /items/pin_owner                    | headers:                            |
      | query:                                    |   x-cache-status: MISS              |
      |   fields:                                 |   x-scoped-cache-tags:              |
      |     - '*'                                 |   - pin_owned_item                  |
      |     - owned_items.*                       |   - pin_owned_sub_item              |
      |     - owned_items.owned_sub_items.*       |   - pin_owner:space=<run>           |
      |   filter:                                 | body:                               |
      |     space:                                |   data:                             |
      |       _eq: <run>                          |   - id: <owner>                     |
      |                                           |     space: <run>                    |
      |                                           |     owned_items:                    |
      |                                           |     - id: <item>                    |
      |                                           |       owner: <owner>                |
      |                                           |       owned_sub_items:              |
      |                                           |       - id: <subitem>               |
      |                                           |         owned_item: <item>          |
      |                                           |         label: after                |

  Scenario: the read is pinned by every collection it embedded
    Given the rows of pin_owner:
      | id      | space |
      | <owner> | <run> |
    And the rows of pin_owned_item:
      | id     | owner   |
      | <item> | <owner> |
    And the rows of pin_owned_sub_item:
      | id        | owned_item | label  |
      | <subitem> | <item>     | before |
    Then these requests get these responses:
      | request                             | response                  |
      | method: GET                         | code: 200                 |+
      | path: /items/pin_owner              | headers:                  |
      | query:                              |   x-cache-status: MISS    |
      |   fields:                           |   x-scoped-cache-tags:    |
      |     - '*'                           |   - pin_owned_item        |
      |     - owned_items.*                 |   - pin_owned_sub_item    |
      |     - owned_items.owned_sub_items.* |   - pin_owner:space=<run> |
      |   filter:                           |                           |
      |     space:                          |                           |
      |       _eq: <run>                    |                           |
