Feature: Every file of a shard reports its completion to the sequential gate

  The `after` files of a shard wait until every other file of the shard has
  reported its completion. A file that never reports holds all of them until
  their 600 s gate times out, and the 10-minute wall of timeouts hides the
  error that caused it.

  Vitest runs no hook for a file whose every test is skipped, nor for a file
  that fails to load. A completion posted from a setup file's `afterAll` is
  then never sent, so it has to come from somewhere every file reaches.

  Scenario: a skipped file and a file that fails to load report like a passing one
    Given a shard of these files:
      | file               |
      | passing.fixture.ts |
      | skipped.fixture.ts |
      | broken.fixture.ts  |
    When the shard runs with the suite's setup files and reporters
    Then each of them posted its completion
