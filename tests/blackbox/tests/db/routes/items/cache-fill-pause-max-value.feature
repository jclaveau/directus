Feature: A deploy's fill pause holds for the ceiling its setting asks for

  CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX takes a duration, and a duration can
  parse to a fraction of a millisecond: "4.1m" is 245999.99999999997 ms. Redis
  refuses a fraction as the pause's expiry, and refuses it only after the boot
  has recorded the build and moved the generation past the completeness
  marker: no pause runs anywhere, and the other nodes go on filling beside the
  build before. The ceiling is rounded up, so a pause never runs shorter than
  asked.

  Only a node that purges by scope files index-key sets, so only it records
  its build and opens the pause. A node with Redis configured that purges the
  whole cache files none, and leaves the build the last scoped boot recorded.

  A ceiling that is not a duration of 0 or more ("-5m", an unparseable value)
  ends the node before it records its build: taking it would open no pause, and
  the build would fill beside the build before.

  Scenario: a ceiling that parses to a fraction of a millisecond opens the pause
    Given the instance runs on max-value-build-a with no fill pause
    When the instance restarts on max-value-build-b pausing fills for at most 4.1m
    Then the fill pause runs on max-value-build-b for at most 246000 ms
    And the recorded build is max-value-build-b
    And the instance logged no failure recording the build

  Scenario: a node that purges the whole cache records no build and opens no pause
    Given the instance has stopped
    And the namespace holds no keys
    When a full-purge instance starts on max-value-build-c pausing for at most 4.1m
    Then no build is recorded
    And no fill pause runs

  Scenario: a negative ceiling ends the node before it records a build
    Given the instance has stopped
    And the namespace holds no keys
    When a scoped instance starts on max-value-build-d pausing for at most -5m
    Then the instance exits with code 1
    And the instance logged that -5m is not a duration of 0 or more
    And no build is recorded
