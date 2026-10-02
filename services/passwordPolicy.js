/**
 * The rule for every new password: register, changing your own, setup, Admin → Users (create and edit) and the
 * admin CLI. Existing shorter passwords keep working; the rule applies when a password is set.
 */
const MIN_PASSWORD_LENGTH = 8;

/** @returns {string|null} What is wrong with a new password, or null when it is fine */
function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}

module.exports = { MIN_PASSWORD_LENGTH, passwordProblem };
