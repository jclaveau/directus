Feature: A server dumps the coverage of each extension into that extension's own directory

  POST /server/dump-coverage writes the coverage collected so far without stopping
  the server, so a test run can report while it is still up. An extension
  built with `coverage` in its extension.config.js registers its coverage
  directory when loaded, and receives the files under its package; COVERAGE_DIR
  receives the rest. The route only exists when something loaded is
  instrumented: here the fixture extension registers its directory and records
  its own coverage, the way an instrumented build does.

  Scenario: an extension built with coverage receives its own files
    Given an extension built with the coverage directory coverage/.tmp/backend
    And a server runs with that extension
    When the coverage is asked for with POST /server/dump-coverage
    Then the answer lists 1 file written into the extension's coverage directory
    And that directory holds one coverage file, with the coverage of src/index.js
