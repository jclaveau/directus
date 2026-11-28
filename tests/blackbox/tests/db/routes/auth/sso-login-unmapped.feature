Feature: Without a role mapping, an SSO login keeps the default role

  - The instance trusts the `mockoauth` (OAuth2) and `mockopenid` (OpenID)
    identity providers the file starts, neither mapping a group to a role:
    every user they register gets the default role d70c0943-...
  - A `login: <provider>` row walks the code flow, the provider answering
    `profile`; `code` replaces the code the provider hands back. Directus
    trades a code the provider never issued for an `invalid_grant` answer,
    and sends the browser back to log in again.
  - Any other row is a request as the admin.

  Scenario: an OAuth2 user keeps the default role whatever their groups
    Then these requests get these responses:
      | request                         | response                                   |
      | login: mockoauth                | code: 200                                  |+
      | profile:                        |                                            |
      |   sub: noa-oauth                |                                            |
      |   email: noa@nomap.example.com  |                                            |
      |   groups: [staff]               |                                            |
      | login: mockoauth                | code: 200                                  |+
      | profile:                        |                                            |
      |   sub: noa-oauth                |                                            |
      |   email: noa@nomap.example.com  |                                            |
      |   groups: [staff]               |                                            |
      | method: GET                     | code: 200                                  |+
      | path: /users                    | body:                                      |
      | query:                          |   data:                                    |
      |   fields:                       |   - identities:                            |
      |     - identities.kind           |     - kind: email                          |
      |     - identities.value          |       value: noa@nomap.example.com         |
      |     - role                      |     - kind: mockoauth                      |
      |   filter:                       |       value: noa-oauth                     |
      |     primary_identity:           |     role: >-                               |
      |       value:                    |       d70c0943-5b55-4c5d-a613-f539a27a57f5 |
      |         _eq: >-                 |                                            |
      |           noa@nomap.example.com |                                            |
      |   deep:                         |                                            |
      |     identities:                 |                                            |
      |       _sort: kind               |                                            |
      | login: mockoauth                | code: 302                                  |+
      | profile:                        | headers:                                   |
      |   sub: noa-oauth                |   location: ./?prompt=true                 |
      |   email: noa@nomap.example.com  |                                            |
      | code: never-issued              |                                            |

  Scenario: an OpenID user keeps the default role whatever their groups
    Then these requests get these responses:
      | request                         | response                                   |
      | login: mockopenid               | code: 200                                  |+
      | profile:                        |                                            |
      |   sub: ida-openid               |                                            |
      |   email: ida@nomap.example.com  |                                            |
      |   groups: [staff]               |                                            |
      | login: mockopenid               | code: 200                                  |+
      | profile:                        |                                            |
      |   sub: ida-openid               |                                            |
      |   email: ida@nomap.example.com  |                                            |
      |   groups: [staff]               |                                            |
      | method: GET                     | code: 200                                  |+
      | path: /users                    | body:                                      |
      | query:                          |   data:                                    |
      |   fields:                       |   - identities:                            |
      |     - identities.kind           |     - kind: email                          |
      |     - identities.value          |       value: ida@nomap.example.com         |
      |     - role                      |     - kind: mockopenid                     |
      |   filter:                       |       value: ida-openid                    |
      |     primary_identity:           |     role: >-                               |
      |       value:                    |       d70c0943-5b55-4c5d-a613-f539a27a57f5 |
      |         _eq: >-                 |                                            |
      |           ida@nomap.example.com |                                            |
      |   deep:                         |                                            |
      |     identities:                 |                                            |
      |       _sort: kind               |                                            |
      | login: mockopenid               | code: 302                                  |+
      | profile:                        | headers:                                   |
      |   sub: ida-openid               |   location: ./?prompt=true                 |
      |   email: ida@nomap.example.com  |                                            |
      | code: never-issued              |                                            |
