Feature: A read's view names the columns that attach a related row to it

  A read reaching a related collection holds the rows of it that are attached to
  the rows it read, so which rows those are is part of what it answers. The
  columns doing the attaching join that collection's view: a write rewriting only
  one of them moves a row in or out of the answer, and it has to purge the read
  even though the read never selected the column.

  A plain to-many always bound its reverse foreign key. Three other ways of
  reaching a collection did not, and a write rewriting only the binding column
  left the read cached with its old answer:

  - a `count()` over a to-many, whose path segment is the function field and so
    names no relation;
  - a three-argument `$FOLLOW(collection, item, collection field)` filter, which
    resolves to an o2a;
  - a filter reaching an A2O item (`blocks.item:heading`), where only an A2O the
    read nested in its fields bound the junction's collection column.

  A read is stated by its `query`, the `response` it answers with, and the
  `bound view`: the view of the related collection's fingerprint, read back out
  of the index, which is where the binding column has to appear. The other
  fingerprints the read is filed under are not stated.

  Every collection declares a `scope_key` no read touches, so a write to it is
  never read as touching every column. Each also carries a column no read names,
  so no view covers the whole collection and is dropped as the view of every
  field.

  Postgres answers a `count()` as a string, which is how the counting scenario
  states it; the pull request runs the blackbox suite on postgres only.

  Every scenario caches a witness read of the same collection that reaches no
  related collection, so a purge flushing the whole collection shows up as a
  witness MISS.

  Background:
    Given the collections:
      | collection           | field                 | type    | scoped_cache_field |
      | view_binding_article | title                 | string  | no                 |
      | view_binding_article | scope_key             | string  | yes                |
      | view_binding_article | comments              | alias   | no                 |
      | view_binding_comment | status                | string  | no                 |
      | view_binding_comment | note                  | string  | no                 |
      | view_binding_comment | scope_key             | string  | yes                |
      | view_binding_comment | article               | integer | no                 |
      | view_binding_topic   | title                 | string  | no                 |
      | view_binding_topic   | scope_key             | string  | yes                |
      | view_binding_mention | item                  | string  | no                 |
      | view_binding_mention | collection            | string  | no                 |
      | view_binding_mention | note                  | string  | no                 |
      | view_binding_mention | scope_key             | string  | yes                |
      | view_binding_page    | title                 | string  | no                 |
      | view_binding_page    | scope_key             | string  | yes                |
      | view_binding_page    | blocks                | alias   | no                 |
      | view_binding_block   | view_binding_block_id | integer | no                 |
      | view_binding_block   | item                  | string  | no                 |
      | view_binding_block   | collection            | string  | no                 |
      | view_binding_block   | scope_key             | string  | yes                |
      | view_binding_heading | title                 | string  | no                 |
      | view_binding_heading | scope_key             | string  | yes                |
      | view_binding_image   | caption               | string  | no                 |
      | view_binding_image   | scope_key             | string  | yes                |

  Scenario: a comment moved to another article purges the count read of its old one
    Given the rows:
      | collection           | marker         | data                                             |
      | view_binding_article | first_article  | {title: first, scope_key: alpha}                 |
      | view_binding_article | second_article | {title: second, scope_key: alpha}                |
      | view_binding_comment | first_comment  | {article: first_article, status: published, scope_key: alpha} |
    And the reads are made by a user reading only published comments
    And this read of view_binding_article is cached:
      | query                 | response                | bound view                        |
      | fields:               | - marker: first_article | collection: view_binding_comment |+
      |   - id                |   comments_count: "1"   | viewFields:                       |
      |   - count(comments)   |                         |   - article                       |
      | filter:               |                         |   - status                        |
      |   title:              |                         |                                   |
      |     _eq: first        |                         |                                   |
    And the witness reads of view_binding_article are cached:
      | query          | response                |
      | fields:        | - marker: first_article |+
      |   - id         |   title: first          |
      |   - title      |                         |
      | filter:        |                         |
      |   title:       |                         |
      |     _eq: first |                         |
    When the view_binding_comment rows are updated:
      | marker        | data                     |
      | first_comment | {article: second_article} |
    Then the read is purged, the comment's article is in the comment view:
      | query               | response                |
      | fields:             | - marker: first_article |+
      |   - id              |   comments_count: "0"   |
      |   - count(comments) |                         |
      | filter:             |                         |
      |   title:            |                         |
      |     _eq: first      |                         |
    And the witness reads are still cached, reaching no comment:
      | query          | response                |
      | fields:        | - marker: first_article |+
      |   - id         |   title: first          |
      |   - title      |                         |
      | filter:        |                         |
      |   title:       |                         |
      |     _eq: first |                         |

  Scenario: a mention moved to another item purges a read following it
    Given the rows:
      | collection           | marker        | data                                                                          |
      | view_binding_topic   | first_topic   | {title: first, scope_key: alpha}                                              |
      | view_binding_topic   | second_topic  | {title: second, scope_key: alpha}                                             |
      | view_binding_mention | first_mention | {item: first_topic, collection: view_binding_topic, note: pinned, scope_key: alpha} |
    And this read of view_binding_topic is cached:
      | query                                            | response              | bound view                        |
      | fields:                                          | - marker: first_topic | collection: view_binding_mention |+
      |   - id                                           |   title: first        | viewFields:                       |
      |   - title                                        |                       |   - collection                    |
      | filter:                                          |                       |   - item                          |
      |   $FOLLOW(view_binding_mention,item,collection): |                       |   - note                          |
      |     note:                                        |                       |                                   |
      |       _eq: pinned                                |                       |                                   |
    And the witness reads of view_binding_topic are cached:
      | query          | response              |
      | fields:        | - marker: first_topic |+
      |   - id         |   title: first        |
      |   - title      |                       |
      | filter:        |                       |
      |   title:       |                       |
      |     _eq: first |                       |
    When the view_binding_mention rows are updated:
      | marker        | data                 |
      | first_mention | {item: second_topic} |
    Then the read is purged, the mention's item is in the mention view:
      | query                                            | response               |
      | fields:                                          | - marker: second_topic |+
      |   - id                                           |   title: second        |
      |   - title                                        |                        |
      | filter:                                          |                        |
      |   $FOLLOW(view_binding_mention,item,collection): |                        |
      |     note:                                        |                        |
      |       _eq: pinned                                |                        |
    And the witness reads are still cached, reaching no mention:
      | query          | response              |
      | fields:        | - marker: first_topic |+
      |   - id         |   title: first        |
      |   - title      |                       |
      | filter:        |                       |
      |   title:       |                       |
      |     _eq: first |                       |

  Scenario: a mention moved to another collection purges a read following it
    Given the rows:
      | collection           | marker        | data                                                                          |
      | view_binding_topic   | first_topic   | {title: first, scope_key: alpha}                                              |
      | view_binding_mention | first_mention | {item: first_topic, collection: view_binding_topic, note: pinned, scope_key: alpha} |
    And this read of view_binding_topic is cached:
      | query                                            | response              | bound view                        |
      | fields:                                          | - marker: first_topic | collection: view_binding_mention |+
      |   - id                                           |   title: first        | viewFields:                       |
      |   - title                                        |                       |   - collection                    |
      | filter:                                          |                       |   - item                          |
      |   $FOLLOW(view_binding_mention,item,collection): |                       |   - note                          |
      |     note:                                        |                       |                                   |
      |       _eq: pinned                                |                       |                                   |
    And the witness reads of view_binding_topic are cached:
      | query          | response              |
      | fields:        | - marker: first_topic |+
      |   - id         |   title: first        |
      |   - title      |                       |
      | filter:        |                       |
      |   title:       |                       |
      |     _eq: first |                       |
    When the view_binding_mention rows are updated:
      | marker        | data                             |
      | first_mention | {collection: view_binding_image} |
    Then the read is purged, the mention's collection is in the mention view:
      | query                                            | response |
      | fields:                                          | []       |+
      |   - id                                           |          |
      |   - title                                        |          |
      | filter:                                          |          |
      |   $FOLLOW(view_binding_mention,item,collection): |          |
      |     note:                                        |          |
      |       _eq: pinned                                |          |
    And the witness reads are still cached, reaching no mention:
      | query          | response              |
      | fields:        | - marker: first_topic |+
      |   - id         |   title: first        |
      |   - title      |                       |
      | filter:        |                       |
      |   title:       |                       |
      |     _eq: first |                       |

  Scenario: a block moved to another collection purges a read filtered through its item
    Given the rows:
      | collection           | marker        | data                                                                                        |
      | view_binding_page    | first_page    | {title: first, scope_key: alpha}                                                            |
      | view_binding_heading | intro_heading | {title: Intro, scope_key: alpha}                                                            |
      | view_binding_block   | first_block   | {view_binding_block_id: first_page, item: intro_heading, collection: view_binding_heading, scope_key: alpha} |
    And this read of view_binding_page is cached:
      | query                          | response             | bound view                     |
      | fields:                        | - marker: first_page | collection: view_binding_block |+
      |   - id                         |   title: first       | viewFields:                    |
      |   - title                      |                      |   - collection                 |
      | filter:                        |                      |   - item                       |
      |   blocks:                      |                      |   - view_binding_block_id      |
      |     item:view_binding_heading: |                      |                                |
      |       title:                   |                      |                                |
      |         _eq: Intro             |                      |                                |
    And the witness reads of view_binding_page are cached:
      | query          | response             |
      | fields:        | - marker: first_page |+
      |   - id         |   title: first       |
      |   - title      |                      |
      | filter:        |                      |
      |   title:       |                      |
      |     _eq: first |                      |
    When the view_binding_block rows are updated:
      | marker      | data                             |
      | first_block | {collection: view_binding_image} |
    Then the read is purged, the block's collection is in the block view:
      | query                          | response |
      | fields:                        | []       |+
      |   - id                         |          |
      |   - title                      |          |
      | filter:                        |          |
      |   blocks:                      |          |
      |     item:view_binding_heading: |          |
      |       title:                   |          |
      |         _eq: Intro             |          |
    And the witness reads are still cached, reaching no block:
      | query          | response             |
      | fields:        | - marker: first_page |+
      |   - id         |   title: first       |
      |   - title      |                      |
      | filter:        |                      |
      |   title:       |                      |
      |     _eq: first |                      |
