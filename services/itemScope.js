const { contentType } = require('./contentTypes');

/**
 * Which items a list shows: a user's personal items (their ID, or { userId }) or a team's items ({ teamId }).
 * Personal lists leave out what the user created in a team: team items belong to the team.
 * @param {'url'|'bundle'|'paste'|'file'} type
 * @param {number|{ userId: number }|{ teamId: number }} scope
 * @returns {{ sql: string, params: array }} A condition on the type's table, qualified with the table name
 */
function scopeCondition(type, scope) {
  const { table, ownerColumn } = contentType(type);
  if (scope && typeof scope === 'object' && scope.teamId !== undefined && scope.teamId !== null) {
    return { sql: `${table}.teamId = ?`, params: [Number(scope.teamId)] };
  }
  const userId = scope && typeof scope === 'object' ? scope.userId : scope;
  return { sql: `${table}.${ownerColumn} = ? AND ${table}.teamId IS NULL`, params: [userId] };
}

module.exports = { scopeCondition };
