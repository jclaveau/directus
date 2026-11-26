Feature: An instance refuses to start on a feature out of the tested scope

  - Each out-of-scope feature is tracked by its issue. An instance turning one
    on starts only when OUT_OF_SCOPE_FEATURES_ALLOWED names it.
  - An instance starts from the shared environment, whose list allows the
    features the other suites run: every one of them starts that way.

  Scenario: an instance with an ldap auth driver it did not allow refuses to start
    When an instance starts with AUTH_PROVIDERS "corp" and AUTH_CORP_DRIVER ldap
    Then it exits naming AUTH_CORP_DRIVER and issue #619

  Scenario: an instance allowing a feature that does not exist refuses to start
    When an instance starts with OUT_OF_SCOPE_FEATURES_ALLOWED "ldapp"
    Then it exits naming OUT_OF_SCOPE_FEATURES_ALLOWED and the features
