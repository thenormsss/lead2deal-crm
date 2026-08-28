const pool = require('../config/db');

// GET /api/pipeline
// Stage is READ-ONLY here — it's driven entirely by task completion (see taskController's
// automation chain in utils/taskFlow.js). There is intentionally no manual override endpoint;
// the only way a stage changes is by marking the relevant task "Done".
exports.getPipeline = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT sp.id, sp.stage, sp.seller_id, sp.property_id,
             s.name AS seller_name, s.phone AS seller_phone,
             p.property_address AS property_address,
             e.team AS team, e.name AS agent_name
      FROM sales_pipeline sp
      JOIN sellers s ON s.id = sp.seller_id
      LEFT JOIN properties p ON p.id = sp.property_id
      LEFT JOIN employees e ON e.id = p.employee_id
      ORDER BY sp.id DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load pipeline.' });
  }
};














// const pool = require('../config/db');

// // GET /api/pipeline
// // Stage is READ-ONLY here — it's driven entirely by task completion (see taskController's
// // automation chain in utils/taskFlow.js). There is intentionally no manual override endpoint;
// // the only way a stage changes is by marking the relevant task "Done".
// exports.getPipeline = async (req, res) => {
//   try {
//     const [rows] = await pool.query(`
//       SELECT sp.id, sp.stage, sp.seller_id, sp.property_id,
//              s.name AS seller_name, s.phone AS seller_phone,
//              p.property_address AS property_address
//       FROM sales_pipeline sp
//       JOIN sellers s ON s.id = sp.seller_id
//       LEFT JOIN properties p ON p.id = sp.property_id
//       ORDER BY sp.id DESC
//     `);
//     res.json(rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to load pipeline.' });
//   }
// };













// const pool = require('../config/db');

// // GET /api/pipeline
// // Stage is READ-ONLY here — it's driven entirely by task completion (see taskController's
// // automation chain in utils/taskFlow.js). There is intentionally no manual override endpoint;
// // the only way a stage changes is by marking the relevant task "Done".
// exports.getPipeline = async (req, res) => {
//   try {
//     const [rows] = await pool.query(`
//       SELECT sp.id, sp.stage, sp.seller_id, sp.property_id,
//              s.name AS seller_name, s.phone AS seller_phone,
//              p.property_address AS property_address
//       FROM sales_pipeline sp
//       JOIN sellers s ON s.id = sp.seller_id
//       JOIN properties p ON p.id = sp.property_id
//       ORDER BY sp.id DESC
//     `);
//     res.json(rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to load pipeline.' });
//   }
// };