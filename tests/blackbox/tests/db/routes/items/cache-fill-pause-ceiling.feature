Feature: A deploy's fill pause ends at its ceiling when the build before stays

  A boot of a build other than the one the last boot recorded pauses its fills
  for at most CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX. The pause ends early once no
  process of another build answers the processes query three looks in a row;
  otherwise it ends at its ceiling, whatever still answers. Either way the node
  logs how long the pause ran and how it ended, and asks for the reap that marks
  the index-key sets complete.

  A node that does not answer the processes query itself, its reports switched
  off by PROCESSES_REPORT_ENABLED, hears nothing it can trust: it never ends the
  pause early, and runs it to its ceiling.

  The ceilings here are 18s, off the 5s looks, so the look that finds the pause
  over is never the one that races its expiry.

  Scenario: a pause the build before outlives ends at its ceiling
    Given these rows of fill_pause_ceiling_outlived:
      | name | label |
      | ada  | old   |
    And a second instance runs on the recorded build
    When the instance restarts on ceiling-build-b pausing fills for at most 18s
    Then these reads are not cached:
      | name | fields     |
      | ada  | name,label |
    And the index-key sets are not marked complete
    And the fill pause ends at its ceiling
    And the instance logged how its fills resumed:
      | ended          |
      | at its ceiling |
    And the index-key sets are marked complete
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |
    When the second instance stops

  Scenario: a node with its process reports off runs the pause to its ceiling
    Given these rows of fill_pause_ceiling_unreported:
      | name | label |
      | ada  | old   |
    And the instance's process reports are off from its next boot
    When the instance restarts on ceiling-build-c pausing fills for at most 18s
    Then these reads are not cached:
      | name | fields     |
      | ada  | name,label |
    And the fill pause ends at its ceiling
    And the instance logged how its fills resumed:
      | ended          |
      | at its ceiling |
    And these reads are cached:
      | name | fields     |
      | ada  | name,label |

  Scenario: a pause the build before leaves logs the quiet looks that ended it
    Given a second instance runs on the recorded build
    When the instance restarts on ceiling-build-d pausing fills for at most 2m
    And the second instance stops
    Then the fill pause ends long before its ceiling
    And the instance logged how its fills resumed:
      | ended                                             |
      | once no process of another build answered 3 looks |
