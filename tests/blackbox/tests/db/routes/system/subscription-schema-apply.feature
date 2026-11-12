Feature: A schema apply over the subscriptions bundle's tables

  - The instance loads the real `@scalabus/subscriptions` bundle, whose migration
    gives `subscription_sync_queue` a `directus_collections` row for its bookmark.
  - `applies a snapshot of this instance without <collection>` reads
    `GET /schema/snapshot` as the admin, drops that collection's collection, fields
    and relations, sends it to `POST /schema/diff`, then `POST /schema/apply` with
    the diff's entries on that collection only, so no other file's table is touched.
  - `the diff deletes these collections` lists each collection entry applied, with
    the kind of its first change.

  Scenario: a snapshot taken before the bundle drops the sync queue when applied
    When the admin applies a snapshot of this instance without subscription_sync_queue
    Then the diff deletes these collections:
      | collection              | kind |
      | subscription_sync_queue | D    |
    And table subscription_sync_queue no longer exists
