Feature: The cache_settings switch keeps a shared Redis cache in step

  Every node here boots with CACHE_ENABLED=false and CACHE_STORE=redis, on the
  same database, Redis and CACHE_NAMESPACE, so only `cache_settings.enabled`
  turns the response cache on.

  - The reader hears every change to the setting on its bus.
  - The lagging node is on a bus of its own and re-reads the setting once a day,
    so it still reads the cache as off after the reader switched it on: it is a
    node that missed the announcement.
  - An entry is a key in the shape `@keyv/redis` files one under:
    `<namespace>_response::<namespace>_response:<key>`.
  - `directus cache flush` runs in a process of its own, the way a deploy step
    runs it, on a namespace of its own.

  What each scenario pins:

  - A write through the lagging node purges what the reader filled: a node's
    stale view of the switch changes what it serves, never what its writes
    purge.
  - The flush command empties the response cache, whether the setting is on
    or was never stored.
  - A switch-on that is refused clears nothing: an anonymous caller gets a 403,
    an admin write the guard refuses for another column gets a 400, and the
    cached entry is still there after either.

  Scenario: a write through a node that missed the switch purges the reader's entry
    Given the reader serves no cached read
    When the reader switches the cache on
    And a label read through the reader is cached
    And the lagging node serves no cached read
    When the label is changed to "v2" through the lagging node
    Then the next label read through the reader is a "MISS" showing "v2"

  Scenario: the flush command empties the response cache the setting switched on
    Given the reader switches the cache on
    And the flush command's response cache holds an entry
    When `directus cache flush` runs
    Then it exits 0
    And the flush command's response cache no longer holds that entry

  Scenario: the flush command empties the response cache with no setting stored
    Given no cache setting is stored
    And the flush command's response cache holds an entry
    When `directus cache flush` runs
    Then it exits 0
    And the flush command's response cache no longer holds that entry

  Scenario: an anonymous switch-on clears nothing
    Given the reader serves no cached read
    And the reader's response cache holds an entry
    When an anonymous caller sends PATCH /settings {"cache_settings":{"enabled":true}}
    Then it answers 403
    And the reader's response cache still holds that entry

  Scenario: a switch-on the guard refuses for its autoscale part clears nothing
    Given the reader serves no cached read
    And the reader's response cache holds an entry
    When an admin sends PATCH /settings {"autoscale_settings":{"not_a_setting":1},"cache_settings":{"enabled":true}}
    Then it answers 400 saying "'not_a_setting' is not a field of the autoscale configuration"
    And the reader's response cache still holds that entry
