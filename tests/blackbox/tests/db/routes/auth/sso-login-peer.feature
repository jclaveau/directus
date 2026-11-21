Feature: An SSO login on one instance ends the reads the peer cached

  - The instance trusts the `mockoauth` identity provider, which the file
    starts on a port of its own and which speaks OAuth2. The group "staff"
    maps the role sso_peer_staff, the group "auditors" the role
    sso_peer_auditors; that row is `managed_by: auth:mockoauth`, and a later
    login replaces it.
  - sso_peer_staff reads `sso_peer_notes`, whose item 1 has the label "v1";
    sso_peer_auditors reads nothing.
  - The feature runs two instances on one database and one bus, each with its
    own response cache in memory. A row sent `on: peer` goes to the second
    one.
  - A `login: mockoauth` row walks the code flow on the first instance, the
    provider answering `profile`; `remember_token: name` keeps the access
    token it got, which `<name>` stands for afterwards. A request is sent as
    the admin, unless it names the token it sends `as`.

  Scenario: an SSO login taking a role away ends the read the peer cached
    Then these requests get these responses:
      | request                               | response                |
      | login: mockoauth                      | code: 200               |+
      | profile:                              |                         |
      |   sub: grace-oauth                    |                         |
      |   email: grace@sso-peer.example.com   |                         |
      |   groups: [staff]                     |                         |
      | remember_token: grace                 |                         |
      | on: peer                              | code: 200               |+
      | as: <grace>                           | body:                   |
      | method: GET                           |   data:                 |
      | path: /items/sso_peer_notes/1         |     label: v1           |
      | query:                                |                         |
      |   fields: label                       |                         |
      | on: peer                              | code: 200               |+
      | as: <grace>                           | headers:                |
      | method: GET                           |   x-cache-status: HIT   |
      | path: /items/sso_peer_notes/1         | body:                   |
      | query:                                |   data:                 |
      |   fields: label                       |     label: v1           |
      | login: mockoauth                      | code: 200               |+
      | profile:                              |                         |
      |   sub: grace-oauth                    |                         |
      |   email: grace@sso-peer.example.com   |                         |
      |   groups: [auditors]                  |                         |
      | on: peer                              | code: 403               |+
      | as: <grace>                           |                         |
      | method: GET                           |                         |
      | path: /items/sso_peer_notes/1         |                         |
      | query:                                |                         |
      |   fields: label                       |                         |
