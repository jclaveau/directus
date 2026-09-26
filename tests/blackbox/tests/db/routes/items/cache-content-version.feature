Feature: A read merged with a content version is purged by a write to its version

  A read asking for a content version — REST `?version=`, GraphQL `version:` —
  answers the item merged with that version's saved delta. The delta is read
  through `getVersionSaves`, which used to leave no fingerprint behind, so the
  merged response was filed under the item read's fingerprints alone. Saving a
  version purges the item's collection itself, but deleting a version or
  renaming its key writes only `directus_versions`, and the merged draft kept
  being served after it.

  A version read is now also filed under the bare `directus_versions`
  fingerprint, whether or not the version it asked for exists: a version renamed
  into the asked key changes an answer that merged nothing.

  A note is created, then every version the scenario names is created on it and
  saved with its `delta`, before any read is cached. A `read` names the note by
  its marker, and carries the `query` a REST read sends or the `graphql` query a
  GraphQL read sends, where `$note` stands for the note's primary key. A GraphQL
  read is sent by a user created for it alone: the GraphQL schema is cached per
  user, and its resolvers keep the service of the request that built it, so only
  a user's first request files the read meta it resolved.

  Every scenario states what the read answers once the write has landed, so a
  purge that never happened shows up as the stale draft it served, and caches
  the note's plain read as a witness: no note is written, so a purge reaching it
  would be a flush.

  Background:
    Given the note collection is versioned

  Scenario: deleting the version purges a read merged with it
    Given the notes:
      | marker | title |
      | target | main  |
    And the versions:
      | marker | note   | key   | delta                  |
      | draft  | target | draft | { "title": "drafted" } |
    And this read is cached:
      | read             | response       |+
      | note: target     | title: drafted |
      | query:           |                |
      |   version: draft |                |
    And the witness reads are cached:
      | read         | response    |+
      | note: target | title: main |
    When the versions are deleted:
      | marker |
      | draft  |
    Then the read is purged, since the version it merged is gone:
      | read             | response    |+
      | note: target     | title: main |
      | query:           |             |
      |   version: draft |             |
    And the witness reads are still cached, since no note was written:
      | read         | response    |+
      | note: target | title: main |

  Scenario: renaming the version's key purges a read merged with it
    Given the notes:
      | marker | title |
      | target | main  |
    And the versions:
      | marker | note   | key   | delta                  |
      | draft  | target | draft | { "title": "drafted" } |
    And this read is cached:
      | read             | response       |+
      | note: target     | title: drafted |
      | query:           |                |
      |   version: draft |                |
    And the witness reads are cached:
      | read         | response    |+
      | note: target | title: main |
    When the versions are renamed:
      | marker | key      |
      | draft  | archived |
    Then the read is purged, since no version holds the asked key any more:
      | read             | response    |+
      | note: target     | title: main |
      | query:           |             |
      |   version: draft |             |
    And the witness reads are still cached, since no note was written:
      | read         | response    |+
      | note: target | title: main |

  Scenario: renaming another version into the asked key purges the read
    Given the notes:
      | marker | title |
      | target | main  |
    And the versions:
      | marker | note   | key   | delta                  |
      | other  | target | other | { "title": "drafted" } |
    And this read is cached:
      | read             | response    |+
      | note: target     | title: main |
      | query:           |             |
      |   version: draft |             |
    And the witness reads are cached:
      | read         | response    |+
      | note: target | title: main |
    When the versions are renamed:
      | marker | key   |
      | other  | draft |
    Then the read is purged, since a version now holds the asked key:
      | read             | response       |+
      | note: target     | title: drafted |
      | query:           |                |
      |   version: draft |                |
    And the witness reads are still cached, since no note was written:
      | read         | response    |+
      | note: target | title: main |

  Scenario: deleting the version purges a GraphQL read merged with it
    Given the notes:
      | marker | title |
      | target | main  |
    And the versions:
      | marker | note   | key   | delta                  |
      | draft  | target | draft | { "title": "drafted" } |
    And this read is cached:
      | read                                      | response                  |+
      | note: target                              | cache_version_note_by_id: |
      | graphql: >-                               |   title: drafted          |
      |   { cache_version_note_by_id(id: "$note", |                           |
      |   version: "draft") { title } }           |                           |
    And the witness reads are cached:
      | read         | response    |+
      | note: target | title: main |
    When the versions are deleted:
      | marker |
      | draft  |
    Then the read is purged, since the version it merged is gone:
      | read                                      | response                  |+
      | note: target                              | cache_version_note_by_id: |
      | graphql: >-                               |   title: main             |
      |   { cache_version_note_by_id(id: "$note", |                           |
      |   version: "draft") { title } }           |                           |
    And the witness reads are still cached, since no note was written:
      | read         | response    |+
      | note: target | title: main |
