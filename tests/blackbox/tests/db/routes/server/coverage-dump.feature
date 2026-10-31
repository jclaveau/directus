Feature: A server dumps the coverage of each extension into that extension's own directory

  POST /server/coverage writes the coverage collected so far without stopping
  the server, so a test run can report while it is still up. An extension
  whose manifest declares a coverage directory, relative to its package,
  receives the files under its package; COVERAGE_DIR receives the rest. The
  route only exists when something loaded is instrumented: here the fixture
  extension records its own coverage, the way an instrumented build does.

  Scenario: an extension declaring a coverage directory receives its own files
    Given an extension declaring the coverage directory coverage/.tmp/backend
    And a server runs with that extension
    When the coverage is asked for with POST /server/coverage
    Then the answer lists 1 file written into the extension's coverage directory
    And that directory holds one coverage file, with the coverage of src/index.js
