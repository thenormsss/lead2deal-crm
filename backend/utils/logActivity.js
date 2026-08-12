const pool = require('../config/db');

/**
 * Records a row in the `activities` table.
 * performedBy = employees.id of the currently logged in user (req.user.id)
 */
async function logActivity(performedBy, activityText) {
  const now = new Date();
  const activity_date = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const activity_time = now.toTimeString().slice(0, 8); // HH:MM:SS

  await pool.query(
    'INSERT INTO activities (performed_by, activity, activity_date, activity_time) VALUES (?, ?, ?, ?)',
    [performedBy, activityText, activity_date, activity_time]
  );
}

module.exports = logActivity;
