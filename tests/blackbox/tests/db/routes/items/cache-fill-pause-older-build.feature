Feature: A process of a build older than the fill pause holds the pause

  The first deploy that ships the fill pause lands beside nodes of a build that
  answers the processes query without naming its core build. The new build
  counts such a process as one of the build before: while it answers, the
  pause holds and no read is filled. Taking it for the new build would end the
  pause after three looks, with the old nodes still filing sets the new
  build's purges do not reach.

  The older process here is the test itself, answering the processes query on
  the instance's bus in the shape a build older than the field answers with.

  Scenario: a process whose report names no build holds the pause while it answers
    Given these rows of fill_pause_older_build:
      | name | label |
      | ada  | old   |
    And a process of a build older than the field answers the processes query
    When the instance restarts on older-build-b pausing fills for at most 2m
    Then the fill pause still runs after 25s
    And these reads are not cached:
      | name | fields     |
      | ada  | name,label |
    And the index-key sets are not marked complete
    When the older process stops answering
    Then the fill pause ends long before its ceiling
    And the index-key sets are marked complete
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
