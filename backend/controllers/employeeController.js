const pool = require('../config/db');

// GET /api/employees  (used to populate "Assigned To" dropdowns)
exports.getAllEmployees = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, team FROM employees ORDER BY name ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load employees.' });
  }
};
