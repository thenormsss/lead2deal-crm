const pool = require('../config/db');

// Maps a property's state to the team responsible for it.
const STATE_TEAM_MAP = {
  Texas: 'Team Texas',
  Florida: 'Team Florida'
};

const ACQUISITION_TEAM = 'Team Acquisition';

/**
 * Picks a random employee from the given team.
 * "There's no condition for who gets picked" -> random assignment within the team.
 */
async function pickRandomAgentFromTeam(team) {
  const [rows] = await pool.query(
    'SELECT id, name, team FROM employees WHERE team = ? ORDER BY RAND() LIMIT 1',
    [team]
  );
  if (rows.length === 0) {
    throw new Error(`No employees found for team "${team}". Add an employee to this team first.`);
  }
  return rows[0]; // { id, name, team }
}

// Used when a new seller is registered (before any property exists)
async function assignAcquisitionAgent() {
  return pickRandomAgentFromTeam(ACQUISITION_TEAM);
}

// Used when a property is created/updated, based on its state
async function assignAgentForState(state) {
  const team = STATE_TEAM_MAP[state];
  if (!team) {
    throw new Error(`No team is mapped to state "${state}"`);
  }
  return pickRandomAgentFromTeam(team);
}

module.exports = {
  STATE_TEAM_MAP,
  ACQUISITION_TEAM,
  assignAcquisitionAgent,
  assignAgentForState
};
