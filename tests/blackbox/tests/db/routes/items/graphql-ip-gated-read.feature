Feature: A GraphQL read runs with the IP of the request that sent it

  A policy can be granted from some IPs only. The GraphQL schema is cached per
  scope, role and user, not per IP, so a user's schema can be built by a
  request from inside the range and reused by one from outside it. What that
  request may read is still decided by its own IP.

  Every scenario creates the user it reads as, granted the `ip_gated` rows by a
  policy that holds from "10.10.10.1" only, and builds that user's schema with
  a read from "10.10.10.1".

  Scenario: a read over HTTP from outside the range is refused
    Given a user whose schema is built by a read from "10.10.10.1"
    When the user reads the rows over HTTP from "10.10.10.2"
    Then the read is refused

  Scenario: a read over a websocket from outside the range is refused
    Given a user whose schema is built by a read from "10.10.10.1"
    When the user reads the rows over a websocket from "10.10.10.2"
    Then the read is refused

  Scenario: a read over a websocket from inside the range answers
    Given a user whose schema is built by a read from "10.10.10.1"
    When the user reads the rows over a websocket from "10.10.10.1"
    Then the read answers:
      """
      ip_gated:
        - label: gated
      """

  Scenario: a subscription from outside the range receives no row
    Given a user whose schema is built by a read from "10.10.10.1"
    And the user subscribes to created rows from "10.10.10.1" and "10.10.10.2"
    When a row labelled "created" is created
    Then the subscription from "10.10.10.1" receives it
    And the subscription from "10.10.10.2" receives no row
