Feature: Every process answers a processes query with the core build it runs

  A process answering a processes query on the bus names the core build it
  runs: CACHE_BUILD_ID where one is set, else the commit baked into the dist.
  The fill pause after a deploy reads it to tell a node of the build before
  from one of its own, so each process must answer with its own, whatever
  build the one asking runs. It travels in the bus report only: the
  /utils/processes tree does not show it.

  Scenario: two processes of two builds each answer with their own build
    Given a process runs on the build core-build-a as the replica a
    And a process runs on the build core-build-b as the replica b
    When the processes are asked on the bus to describe themselves
    Then these replicas answered:
      | replica | build        |
      | a       | core-build-a |
      | b       | core-build-b |
