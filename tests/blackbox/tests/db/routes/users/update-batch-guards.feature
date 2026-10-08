Feature: A batch update of users is checked as a single update is

  A batch reaches the users service as one change per row, and each change is
  checked as the change of a single update is. A user is named by its first
  name.

  Scenario: a batch setting a tfa_secret is refused and writes nothing
    Given the user "tfa-batch"
    When the batch sends:
      | first_name | tfa_secret |
      | renamed    | x          |
    Then the update is refused with a reason naming "tfa_secret"
    And the user holds:
      | first_name | tfa_secret |
      | tfa-batch  |            |
