Feature: A pool reading heals from what the bus lost

  The autoscaler sends the pool reading when it changes, and otherwise only once
  a refresh (`PM2_POOL_HEALTH_REFRESH`, 30 minutes by default). Pub/sub keeps
  nothing for a subscriber that is away, so a reading sent while a Directus was
  reconnecting never reaches it. Three things bring the picture back:

  - a Directus whose bus reconnected asks for the reading again;
  - an unchanged reading is sent again once a refresh went by;
  - a reading nobody repeated for two refreshes is read as nothing said, which is
    what takes back the reading of an autoscaler killed before it could.

  Every scenario runs a pool of two workers the supervisor gives up on one of, so
  the reading carries one failed worker and `/server/health` warns about it.

  Scenario: a Directus whose bus reconnected asks for the reading again
    Given a pool short of one worker, reported with the default refresh
    And a Directus on its bus warning about the pool
    When the bus carries a reading of a full pool
    Then the Directus no longer warns about the pool
    When Redis drops every connection of that Directus
    Then the Directus asks for the reading on "poolHealth:query"
    And the Directus warns about the pool again

  Scenario: an unchanged reading is sent again once a refresh went by
    Given a pool short of one worker, reported with a refresh of 4s
    When the bus is listened to for 15 seconds
    Then the reading is heard at least 3 times, 4 to 8 seconds apart

  Scenario: a reading its killed reporter never took back expires after two refreshes
    Given a pool short of one worker, reported with a refresh of 4s
    And a Directus on its bus warning about the pool
    When the autoscaler is killed without a chance to take its reading back
    Then the Directus stops warning about the pool within 15 seconds
    And nothing was sent on "poolHealth" after the kill
