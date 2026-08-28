const pool = require('../config/db');

// GET /api/dashboard  -> counts driven entirely by sales_pipeline.stage, as confirmed
exports.getDashboardStats = async (req, res) => {
  try {
    const [[newLeads]] = await pool.query("SELECT COUNT(*) AS count FROM sales_pipeline WHERE stage = 'New Lead'");
    const [[qualify]] = await pool.query("SELECT COUNT(*) AS count FROM sales_pipeline WHERE stage = 'Contacted'");
    const [[appointments]] = await pool.query("SELECT COUNT(*) AS count FROM sales_pipeline WHERE stage = 'Appointment'");
    const [[offers]] = await pool.query("SELECT COUNT(*) AS count FROM sales_pipeline WHERE stage = 'Offer'");
    const [[contracts]] = await pool.query("SELECT COUNT(*) AS count FROM sales_pipeline WHERE stage = 'Under Contract'");
    const [[closedDeals]] = await pool.query("SELECT COUNT(*) AS count FROM sales_pipeline WHERE stage = 'Closed'");

    const [leadSourceRows] = await pool.query(`
      SELECT lead_source AS source, COUNT(*) AS count
      FROM sellers
      GROUP BY lead_source
      ORDER BY count DESC
    `);

    res.json({
      newLeads: newLeads.count,
      qualify: qualify.count,
      appointments: appointments.count,
      offers: offers.count,
      contracts: contracts.count,
      closedDeals: closedDeals.count,
      leadSourceBreakdown: leadSourceRows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load dashboard stats.' });
  }
};












//NECROWL

// const pool = require('../config/db');

// // GET /api/dashboard  -> counts driven entirely by sales_pipeline.stage, as confirmed
// exports.getDashboardStats = async (req, res) => {
//   try {
//     const [[newLeads]] = await pool.query("SELECT COUNT(*) AS count FROM sales_pipeline WHERE stage = 'New Lead'");
//     const [[qualify]] = await pool.query("SELECT COUNT(*) AS count FROM sales_pipeline WHERE stage = 'Qualify'");
//     const [[appointments]] = await pool.query("SELECT COUNT(*) AS count FROM sales_pipeline WHERE stage = 'Appointment'");
//     const [[offers]] = await pool.query("SELECT COUNT(*) AS count FROM sales_pipeline WHERE stage = 'Offer'");
//     const [[contracts]] = await pool.query("SELECT COUNT(*) AS count FROM sales_pipeline WHERE stage = 'Contract'");
//     const [[closedDeals]] = await pool.query("SELECT COUNT(*) AS count FROM sales_pipeline WHERE stage = 'Closed - Won'");

//     const [leadSourceRows] = await pool.query(`
//       SELECT lead_source AS source, COUNT(*) AS count
//       FROM sellers
//       GROUP BY lead_source
//       ORDER BY count DESC
//     `);

//     res.json({
//       newLeads: newLeads.count,
//       qualify: qualify.count,
//       appointments: appointments.count,
//       offers: offers.count,
//       contracts: contracts.count,
//       closedDeals: closedDeals.count,
//       leadSourceBreakdown: leadSourceRows
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to load dashboard stats.' });
//   }
// };
