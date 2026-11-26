Feature: An instance starts on a feature out of the tested scope only when allowed

  - Each out-of-scope feature is tracked by its issue. An instance turning one
    on starts only when OUT_OF_SCOPE_FEATURES_ALLOWED names it, and logs every
    refusal before it exits.
  - An instance starts from the shared environment, which turns on the SAML
    login (AUTH_SAML_DRIVER "saml") and the GraphQL websocket, and allows
    saml,oauth2,openid,websockets-graphql,shares,comments. The variables a
    scenario lists override it.
  - An instance logs JSON lines (LOG_STYLE raw): an errors cell lists every
    message it logs at the error level, in their order.
  - The ldap login refuses a payload with no password before it reaches the
    LDAP server, so nothing listens on AUTH_CORP_CLIENT_URL.
  - `<package_folder>` stands for a folder of the scenario's own, whose
    package.json depends on the package the scenario names alone: the
    instance loads that one extension.
  - A request authenticates as nobody. A response cell states the keys it
    checks.

  Scenario: an instance with an ldap auth driver it did not allow refuses to start
    When an instance starts with these variables:
      | variable         | value |
      | AUTH_PROVIDERS   | corp  |
      | AUTH_CORP_DRIVER | ldap  |
    Then it exits with code 1, logging these errors:
      | errors                                                         |
      | - >-                                                           |+
      |   "AUTH_CORP_DRIVER" Environment Variable is "ldap", a feature |
      |   out of the tested scope (#619): add "ldap" to                |
      |   OUT_OF_SCOPE_FEATURES_ALLOWED to run it untested.            |

  Scenario: an instance with an oauth2 auth driver it did not allow refuses to start
    When an instance starts with these variables:
      | variable                      | value              |
      | AUTH_PROVIDERS                | corp               |
      | AUTH_CORP_DRIVER              | oauth2             |
      | OUT_OF_SCOPE_FEATURES_ALLOWED | websockets-graphql |
    Then it exits with code 1, logging these errors:
      | errors                                                           |
      | - >-                                                             |+
      |   "AUTH_CORP_DRIVER" Environment Variable is "oauth2", a feature |
      |   out of the tested scope (#622): add "oauth2" to                |
      |   OUT_OF_SCOPE_FEATURES_ALLOWED to run it untested.              |

  Scenario: an instance with an openid auth driver it did not allow refuses to start
    When an instance starts with these variables:
      | variable                      | value              |
      | AUTH_PROVIDERS                | corp               |
      | AUTH_CORP_DRIVER              | openid             |
      | OUT_OF_SCOPE_FEATURES_ALLOWED | websockets-graphql |
    Then it exits with code 1, logging these errors:
      | errors                                                           |
      | - >-                                                             |+
      |   "AUTH_CORP_DRIVER" Environment Variable is "openid", a feature |
      |   out of the tested scope (#622): add "openid" to                |
      |   OUT_OF_SCOPE_FEATURES_ALLOWED to run it untested.              |

  Scenario: an instance with the saml auth driver it did not allow refuses to start
    When an instance starts with these variables:
      | variable                      | value              |
      | OUT_OF_SCOPE_FEATURES_ALLOWED | websockets-graphql |
    Then it exits with code 1, logging these errors:
      | errors                                                         |
      | - >-                                                           |+
      |   "AUTH_SAML_DRIVER" Environment Variable is "saml", a feature |
      |   out of the tested scope (#622): add "saml" to                |
      |   OUT_OF_SCOPE_FEATURES_ALLOWED to run it untested.            |

  Scenario: an instance with the GraphQL websocket it did not allow refuses to start
    When an instance starts with these variables:
      | variable                      | value |
      | OUT_OF_SCOPE_FEATURES_ALLOWED | saml  |
    Then it exits with code 1, logging these errors:
      | errors                                                         |
      | - >-                                                           |+
      |   "WEBSOCKETS_GRAPHQL_ENABLED" Environment Variable is true, a |
      |   feature out of the tested scope (#756): add                  |
      |   "websockets-graphql" to OUT_OF_SCOPE_FEATURES_ALLOWED to run |
      |   it untested.                                                 |

  Scenario: an instance with extension auto-reload it did not allow refuses to start
    When an instance starts with these variables:
      | variable               | value |
      | EXTENSIONS_AUTO_RELOAD | true  |
    Then it exits with code 1, logging these errors:
      | errors                                                         |
      | - >-                                                           |+
      |   "EXTENSIONS_AUTO_RELOAD" Environment Variable is true, a     |
      |   feature out of the tested scope (#627): add                  |
      |   "extensions-auto-reload" to OUT_OF_SCOPE_FEATURES_ALLOWED to |
      |   run it untested.                                             |

  Scenario: an instance allowing a feature that does not exist refuses to start
    When an instance starts with these variables:
      | variable                      | value                         |
      | OUT_OF_SCOPE_FEATURES_ALLOWED | saml,websockets-graphql,ldapp |
    Then it exits with code 1, logging these errors:
      | errors                                                       |
      | - >-                                                         |+
      |   "OUT_OF_SCOPE_FEATURES_ALLOWED" Environment Variable names |
      |   "ldapp", which is not one of ldap, oauth2, openid, saml,   |
      |   websockets-graphql, extensions-auto-reload, shares,        |
      |   comments.                                                  |

  Scenario: an instance logs every refusal before it exits
    When an instance starts with these variables:
      | variable                      | value |
      | OUT_OF_SCOPE_FEATURES_ALLOWED | ldapp |
      | EXTENSIONS_AUTO_RELOAD        | true  |
    Then it exits with code 1, logging these errors:
      | errors                                                         |
      | - >-                                                           |+
      |   "OUT_OF_SCOPE_FEATURES_ALLOWED" Environment Variable names   |
      |   "ldapp", which is not one of ldap, oauth2, openid, saml,     |
      |   websockets-graphql, extensions-auto-reload, shares,          |
      |   comments.                                                    |
      | - >-                                                           |+
      |   "AUTH_SAML_DRIVER" Environment Variable is "saml", a feature |
      |   out of the tested scope (#622): add "saml" to                |
      |   OUT_OF_SCOPE_FEATURES_ALLOWED to run it untested.            |
      | - >-                                                           |+
      |   "WEBSOCKETS_GRAPHQL_ENABLED" Environment Variable is true, a |
      |   feature out of the tested scope (#756): add                  |
      |   "websockets-graphql" to OUT_OF_SCOPE_FEATURES_ALLOWED to run |
      |   it untested.                                                 |
      | - >-                                                           |+
      |   "EXTENSIONS_AUTO_RELOAD" Environment Variable is true, a     |
      |   feature out of the tested scope (#627): add                  |
      |   "extensions-auto-reload" to OUT_OF_SCOPE_FEATURES_ALLOWED to |
      |   run it untested.                                             |

  Scenario: an instance allowing the ldap auth driver starts and serves its login
    When an instance starts with these variables:
      | variable                      | value                   |
      | AUTH_PROVIDERS                | corp                    |
      | AUTH_CORP_DRIVER              | ldap                    |
      | AUTH_CORP_CLIENT_URL          | ldap://127.0.0.1:1      |
      | AUTH_CORP_BIND_DN             | cn=directus,dc=corp     |
      | AUTH_CORP_BIND_PASSWORD       | bind-secret             |
      | AUTH_CORP_USER_DN             | ou=users,dc=corp        |
      | OUT_OF_SCOPE_FEATURES_ALLOWED | websockets-graphql,ldap |
    Then these requests get these responses:
      | request                | response                                 |
      | method: POST           | code: 400                                |+
      | path: /auth/login/corp | body:                                    |
      | payload:               |   errors:                                |
      |   identifier: ada      |     - message: >-                        |
      |                        |         Invalid payload. "password" is   |
      |                        |         required.                        |
      |                        |       extensions:                        |
      |                        |         reason: '"password" is required' |
      |                        |         code: INVALID_PAYLOAD            |

  Scenario: an instance allowing extension auto-reload serves an endpoint's new code
    Given the package "reload-probe" holds an endpoint answering "first"
    When an instance starts with these variables:
      | variable                      | value                                          |
      | PACKAGE_FILE_LOCATION         | <package_folder>                               |
      | EXTENSIONS_AUTO_RELOAD        | true                                           |
      | OUT_OF_SCOPE_FEATURES_ALLOWED | saml,websockets-graphql,extensions-auto-reload |
    Then these requests get these responses:
      | request             | response    |
      | method: GET         | code: 200   |+
      | path: /reload-probe | text: first |
    When the endpoint of "reload-probe" is rewritten to answer "second"
    Then these requests get these responses within 20 seconds:
      | request             | response     |
      | method: GET         | code: 200    |+
      | path: /reload-probe | text: second |
