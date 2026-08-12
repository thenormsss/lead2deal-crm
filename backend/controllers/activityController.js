const pool = require('../config/db');

// GET /api/activities  (Logs module — newest first)
exports.getAllActivities = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT a.id, a.activity, a.activity_date, a.activity_time, e.name AS performed_by
      FROM activities a
      JOIN employees e ON e.id = a.performed_by
      ORDER BY a.activity_date DESC, a.activity_time DESC, a.id DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load activity logs.' });
  }
};
