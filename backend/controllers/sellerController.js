const pool = require('../config/db');
const logActivity = require('../utils/logActivity');
const { assignAcquisitionAgent } = require('../utils/assignAgent');
const { TASK_NAMES } = require('../utils/taskFlow');
const { getNextDayDateString, getRandomAvailableTimeSlot } = require('../utils/scheduling');

// Philippine mobile format: 09XXXXXXXXX (11 digits, starts with 09)
const PH_PHONE_REGEX = /^09\d{9}$/;
// Basic email shape check — good enough to catch typos without being overly strict
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Letters, spaces, and the punctuation that legitimately shows up in real names
// (periods, hyphens, apostrophes) — blocks digits/symbols without being too restrictive
const NAME_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ.'\- ]+$/;

// Mirrors the enum() definitions on the `sellers` table exactly, so a bad value is caught
// here with a clear message instead of surfacing as a raw MySQL error.
const LEAD_SOURCES = ['Facebook', 'Website', 'Referral', 'TV', 'Walk-in', 'YouTube'];
const SELLER_STATUSES = ['Active', 'Inactive', 'Invalid'];

// Runs every check for name/phone/email/lead_source (and status, if provided) and returns
// the first error message found, or null if everything is valid.
function validateSellerFields({ name, phone, email, lead_source, status }) {
  if (!name || !name.trim()) return 'Name is required.';
  const trimmedName = name.trim();
  if (trimmedName.length < 2) return 'Name must be at least 2 characters.';
  if (trimmedName.length > 100) return 'Name must be 100 characters or fewer.';
  if (!NAME_REGEX.test(trimmedName)) return 'Name can only contain letters, spaces, periods, hyphens, and apostrophes.';

  if (!phone || !phone.trim()) return 'Phone number is required.';
  if (!PH_PHONE_REGEX.test(phone.trim())) {
    return 'Phone number must be 11 digits starting with 09 (e.g. 09123456789).';
  }

  if (email && email.trim()) {
    if (email.trim().length > 150) return 'Email must be 150 characters or fewer.';
    if (!EMAIL_REGEX.test(email.trim())) return 'Please enter a valid email address (e.g. name@example.com).';
  }

  if (!lead_source) return 'Lead source is required.';
  if (!LEAD_SOURCES.includes(lead_source)) {
    return `Lead source must be one of: ${LEAD_SOURCES.join(', ')}.`;
  }

  if (status !== undefined && status !== null && !SELLER_STATUSES.includes(status)) {
    return `Status must be one of: ${SELLER_STATUSES.join(', ')}.`;
  }

  return null;
}

// GET /api/sellers
exports.getAllSellers = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM sellers ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load leads/sellers.' });
  }
};

// POST /api/sellers  (Create Lead)
exports.createSeller = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { name, phone, email, lead_source } = req.body;

    const validationError = validateSellerFields({ name, phone, email, lead_source });
    if (validationError) {
      conn.release();
      return res.status(400).json({ message: validationError });
    }

    await conn.beginTransaction();

    // seller_type defaults to 'Lead', status defaults to 'Active' per schema
    const [result] = await conn.query(
      'INSERT INTO sellers (name, phone, email, lead_source) VALUES (?, ?, ?, ?)',
      [name.trim(), phone.trim(), email ? email.trim() : '', lead_source]
    );
    const sellerId = result.insertId;

    // Auto-create the first task: "Get Property Info" assigned to a Team Acquisition agent
    const agent = await assignAcquisitionAgent();
    const dueDate = getNextDayDateString();
    const dueTime = await getRandomAvailableTimeSlot(conn, agent.id, dueDate);
    await conn.query(
      `INSERT INTO tasks (task, seller_id, property_id, task_date, task_time, assigned_to, status)
       VALUES (?, ?, NULL, ?, ?, ?, 'Not Done')`,
      [TASK_NAMES.GET_PROPERTY_INFO, sellerId, dueDate, dueTime, agent.id]
    );

    // The seller shows up in the Pipeline module immediately, at "New Lead" — before any
    // property exists. property_id starts NULL and gets attached once their first
    // property is recorded (see propertyController.createProperty).
    await conn.query(
      "INSERT INTO sales_pipeline (seller_id, property_id, stage) VALUES (?, NULL, 'New Lead')",
      [sellerId]
    );

    await conn.commit();
    conn.release();

    await logActivity(req.user.id, `New lead "${name.trim()}" was created and assigned to ${agent.name} for property info gathering.`);

    const [rows] = await pool.query('SELECT * FROM sellers WHERE id = ?', [sellerId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error(err);
    res.status(500).json({ message: err.sqlMessage || err.message || 'Failed to create lead.' });
  }
};

// PUT /api/sellers/:id  (Update info — seller_type is NEVER editable manually)
// - Status changed TO "Inactive" or "Invalid": every task and pipeline entry tied to this
//   seller (across ALL their properties) is removed — they drop out of the Task and
//   Pipeline modules entirely. Seller/property records themselves stay intact for history.
// - Status changed back TO "Active" from either of those: a fresh "Get Property Info"
//   task and a new "New Lead" pipeline entry are recreated, exactly like a brand-new
//   registration — even if they already have properties on file.
exports.updateSeller = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { name, phone, email, lead_source, status } = req.body; // seller_type intentionally excluded

    const validationError = validateSellerFields({ name, phone, email, lead_source, status });
    if (validationError) {
      conn.release();
      return res.status(400).json({ message: validationError });
    }

    const [existing] = await conn.query('SELECT * FROM sellers WHERE id = ?', [id]);
    if (existing.length === 0) {
      conn.release();
      return res.status(404).json({ message: 'Lead/Seller not found.' });
    }

    const previousStatus = existing[0].status;
    const finalStatus = status ?? previousStatus;
    const statusChanged = finalStatus !== previousStatus;
    const becameInactiveOrInvalid = statusChanged && (finalStatus === 'Inactive' || finalStatus === 'Invalid');
    const becameActiveAgain =
      statusChanged && finalStatus === 'Active' && (previousStatus === 'Inactive' || previousStatus === 'Invalid');

    await conn.beginTransaction();

    await conn.query(
      'UPDATE sellers SET name = ?, phone = ?, email = ?, lead_source = ?, status = ? WHERE id = ?',
      [
        name.trim(),
        phone.trim(),
        email ? email.trim() : '',
        lead_source,
        finalStatus,
        id
      ]
    );

    let cleanupNote = '';
    if (becameInactiveOrInvalid) {
      const [taskDelResult] = await conn.query('DELETE FROM tasks WHERE seller_id = ?', [id]);
      const [pipelineDelResult] = await conn.query('DELETE FROM sales_pipeline WHERE seller_id = ?', [id]);
      cleanupNote = ` Status set to "${finalStatus}": removed ${taskDelResult.affectedRows} task(s) and ${pipelineDelResult.affectedRows} pipeline entr${pipelineDelResult.affectedRows === 1 ? 'y' : 'ies'}.`;
    } else if (becameActiveAgain) {
      // Guard against duplicates: only recreate what's actually missing. This matters if
      // a seller gets toggled Active/Inactive more than once, or if something was left
      // over from before (e.g. they still have properties "On Process" whose pipeline
      // entries weren't touched by the Inactive/Invalid cleanup in a previous version).
      const [existingOpenTask] = await conn.query(
        `SELECT id FROM tasks WHERE seller_id = ? AND task = ? AND property_id IS NULL AND status = 'Not Done' LIMIT 1`,
        [id, TASK_NAMES.GET_PROPERTY_INFO]
      );
      const [existingUnattachedPipeline] = await conn.query(
        'SELECT id FROM sales_pipeline WHERE seller_id = ? AND property_id IS NULL LIMIT 1',
        [id]
      );

      const notes = [];

      if (existingOpenTask.length === 0) {
        const agent = await assignAcquisitionAgent();
        const dueDate = getNextDayDateString();
        const dueTime = await getRandomAvailableTimeSlot(conn, agent.id, dueDate);
        await conn.query(
          `INSERT INTO tasks (task, seller_id, property_id, task_date, task_time, assigned_to, status)
           VALUES (?, ?, NULL, ?, ?, ?, 'Not Done')`,
          [TASK_NAMES.GET_PROPERTY_INFO, id, dueDate, dueTime, agent.id]
        );
        notes.push(`recreated "Get Property Info" task (assigned to ${agent.name})`);
      }

      if (existingUnattachedPipeline.length === 0) {
        await conn.query(
          "INSERT INTO sales_pipeline (seller_id, property_id, stage) VALUES (?, NULL, 'New Lead')",
          [id]
        );
        notes.push('added a new pipeline entry at "New Lead"');
      }

      cleanupNote = notes.length > 0
        ? ` Reactivated: ${notes.join(' and ')}.`
        : ' Reactivated: task and pipeline entry already existed, nothing duplicated.';
    }

    await conn.commit();
    conn.release();

    await logActivity(req.user.id, `Updated info for "${existing[0].name}".${cleanupNote}`);

    const [rows] = await pool.query('SELECT * FROM sellers WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error(err);
    res.status(500).json({ message: err.sqlMessage || err.message || 'Failed to update lead/seller.' });
  }
};




















// const pool = require('../config/db');
// const logActivity = require('../utils/logActivity');
// const { assignAcquisitionAgent } = require('../utils/assignAgent');
// const { TASK_NAMES } = require('../utils/taskFlow');

// // Philippine mobile format: 09XXXXXXXXX (11 digits, starts with 09)
// const PH_PHONE_REGEX = /^09\d{9}$/;
// // Basic email shape check — good enough to catch typos without being overly strict
// const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// // Letters, spaces, and the punctuation that legitimately shows up in real names
// // (periods, hyphens, apostrophes) — blocks digits/symbols without being too restrictive
// const NAME_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ.'\- ]+$/;

// // Mirrors the enum() definitions on the `sellers` table exactly, so a bad value is caught
// // here with a clear message instead of surfacing as a raw MySQL error.
// const LEAD_SOURCES = ['Facebook', 'Website', 'Referral', 'TV', 'Walk-in', 'YouTube'];
// const SELLER_STATUSES = ['Active', 'Inactive', 'Invalid'];

// // Runs every check for name/phone/email/lead_source (and status, if provided) and returns
// // the first error message found, or null if everything is valid.
// function validateSellerFields({ name, phone, email, lead_source, status }) {
//   if (!name || !name.trim()) return 'Name is required.';
//   const trimmedName = name.trim();
//   if (trimmedName.length < 2) return 'Name must be at least 2 characters.';
//   if (trimmedName.length > 100) return 'Name must be 100 characters or fewer.';
//   if (!NAME_REGEX.test(trimmedName)) return 'Name can only contain letters, spaces, periods, hyphens, and apostrophes.';

//   if (!phone || !phone.trim()) return 'Phone number is required.';
//   if (!PH_PHONE_REGEX.test(phone.trim())) {
//     return 'Phone number must be 11 digits starting with 09 (e.g. 09123456789).';
//   }

//   if (email && email.trim()) {
//     if (email.trim().length > 150) return 'Email must be 150 characters or fewer.';
//     if (!EMAIL_REGEX.test(email.trim())) return 'Please enter a valid email address (e.g. name@example.com).';
//   }

//   if (!lead_source) return 'Lead source is required.';
//   if (!LEAD_SOURCES.includes(lead_source)) {
//     return `Lead source must be one of: ${LEAD_SOURCES.join(', ')}.`;
//   }

//   if (status !== undefined && status !== null && !SELLER_STATUSES.includes(status)) {
//     return `Status must be one of: ${SELLER_STATUSES.join(', ')}.`;
//   }

//   return null;
// }

// // GET /api/sellers
// exports.getAllSellers = async (req, res) => {
//   try {
//     const [rows] = await pool.query('SELECT * FROM sellers ORDER BY id DESC');
//     res.json(rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to load leads/sellers.' });
//   }
// };

// // POST /api/sellers  (Create Lead)
// exports.createSeller = async (req, res) => {
//   const conn = await pool.getConnection();
//   try {
//     const { name, phone, email, lead_source } = req.body;

//     const validationError = validateSellerFields({ name, phone, email, lead_source });
//     if (validationError) {
//       conn.release();
//       return res.status(400).json({ message: validationError });
//     }

//     await conn.beginTransaction();

//     // seller_type defaults to 'Lead', status defaults to 'Active' per schema
//     const [result] = await conn.query(
//       'INSERT INTO sellers (name, phone, email, lead_source) VALUES (?, ?, ?, ?)',
//       [name.trim(), phone.trim(), email ? email.trim() : '', lead_source]
//     );
//     const sellerId = result.insertId;

//     // Auto-create the first task: "Get Property Info" assigned to a Team Acquisition agent
//     const agent = await assignAcquisitionAgent();
//     const today = new Date().toISOString().slice(0, 10);
//     await conn.query(
//       `INSERT INTO tasks (task, seller_id, property_id, task_date, task_time, assigned_to, status)
//        VALUES (?, ?, NULL, ?, '09:00:00', ?, 'Not Done')`,
//       [TASK_NAMES.GET_PROPERTY_INFO, sellerId, today, agent.id]
//     );

//     // The seller shows up in the Pipeline module immediately, at "New Lead" — before any
//     // property exists. property_id starts NULL and gets attached once their first
//     // property is recorded (see propertyController.createProperty).
//     await conn.query(
//       "INSERT INTO sales_pipeline (seller_id, property_id, stage) VALUES (?, NULL, 'New Lead')",
//       [sellerId]
//     );

//     await conn.commit();
//     conn.release();

//     await logActivity(req.user.id, `New lead "${name.trim()}" was created and assigned to ${agent.name} for property info gathering.`);

//     const [rows] = await pool.query('SELECT * FROM sellers WHERE id = ?', [sellerId]);
//     res.status(201).json(rows[0]);
//   } catch (err) {
//     await conn.rollback();
//     conn.release();
//     console.error(err);
//     res.status(500).json({ message: err.sqlMessage || err.message || 'Failed to create lead.' });
//   }
// };

// // PUT /api/sellers/:id  (Update info — seller_type is NEVER editable manually)
// // - Status changed TO "Inactive" or "Invalid": every task and pipeline entry tied to this
// //   seller (across ALL their properties) is removed — they drop out of the Task and
// //   Pipeline modules entirely. Seller/property records themselves stay intact for history.
// // - Status changed back TO "Active" from either of those: a fresh "Get Property Info"
// //   task and a new "New Lead" pipeline entry are recreated, exactly like a brand-new
// //   registration — even if they already have properties on file. Duplicates are avoided:
// //   each piece is only recreated if it doesn't already exist.
// exports.updateSeller = async (req, res) => {
//   const conn = await pool.getConnection();
//   try {
//     const { id } = req.params;
//     const { name, phone, email, lead_source, status } = req.body; // seller_type intentionally excluded

//     const validationError = validateSellerFields({ name, phone, email, lead_source, status });
//     if (validationError) {
//       conn.release();
//       return res.status(400).json({ message: validationError });
//     }

//     const [existing] = await conn.query('SELECT * FROM sellers WHERE id = ?', [id]);
//     if (existing.length === 0) {
//       conn.release();
//       return res.status(404).json({ message: 'Lead/Seller not found.' });
//     }

//     const previousStatus = existing[0].status;
//     const finalStatus = status ?? previousStatus;
//     const statusChanged = finalStatus !== previousStatus;
//     const becameInactiveOrInvalid = statusChanged && (finalStatus === 'Inactive' || finalStatus === 'Invalid');
//     const becameActiveAgain =
//       statusChanged && finalStatus === 'Active' && (previousStatus === 'Inactive' || previousStatus === 'Invalid');

//     await conn.beginTransaction();

//     await conn.query(
//       'UPDATE sellers SET name = ?, phone = ?, email = ?, lead_source = ?, status = ? WHERE id = ?',
//       [
//         name.trim(),
//         phone.trim(),
//         email ? email.trim() : '',
//         lead_source,
//         finalStatus,
//         id
//       ]
//     );

//     let cleanupNote = '';
//     if (becameInactiveOrInvalid) {
//       const [taskDelResult] = await conn.query('DELETE FROM tasks WHERE seller_id = ?', [id]);
//       const [pipelineDelResult] = await conn.query('DELETE FROM sales_pipeline WHERE seller_id = ?', [id]);
//       cleanupNote = ` Status set to "${finalStatus}": removed ${taskDelResult.affectedRows} task(s) and ${pipelineDelResult.affectedRows} pipeline entr${pipelineDelResult.affectedRows === 1 ? 'y' : 'ies'}.`;
//     } else if (becameActiveAgain) {
//       // Guard against duplicates: only recreate what's actually missing. This matters if
//       // a seller gets toggled Active/Inactive more than once, or if something was left
//       // over from before (e.g. they still have properties "On Process" whose pipeline
//       // entries weren't touched by the Inactive/Invalid cleanup in a previous version).
//       const [existingOpenTask] = await conn.query(
//         `SELECT id FROM tasks WHERE seller_id = ? AND task = ? AND property_id IS NULL AND status = 'Not Done' LIMIT 1`,
//         [id, TASK_NAMES.GET_PROPERTY_INFO]
//       );
//       const [existingUnattachedPipeline] = await conn.query(
//         'SELECT id FROM sales_pipeline WHERE seller_id = ? AND property_id IS NULL LIMIT 1',
//         [id]
//       );

//       const notes = [];

//       if (existingOpenTask.length === 0) {
//         const agent = await assignAcquisitionAgent();
//         const today = new Date().toISOString().slice(0, 10);
//         await conn.query(
//           `INSERT INTO tasks (task, seller_id, property_id, task_date, task_time, assigned_to, status)
//            VALUES (?, ?, NULL, ?, '09:00:00', ?, 'Not Done')`,
//           [TASK_NAMES.GET_PROPERTY_INFO, id, today, agent.id]
//         );
//         notes.push(`recreated "Get Property Info" task (assigned to ${agent.name})`);
//       }

//       if (existingUnattachedPipeline.length === 0) {
//         await conn.query(
//           "INSERT INTO sales_pipeline (seller_id, property_id, stage) VALUES (?, NULL, 'New Lead')",
//           [id]
//         );
//         notes.push('added a new pipeline entry at "New Lead"');
//       }

//       cleanupNote = notes.length > 0
//         ? ` Reactivated: ${notes.join(' and ')}.`
//         : ' Reactivated: task and pipeline entry already existed, nothing duplicated.';
//     }

//     await conn.commit();
//     conn.release();

//     await logActivity(req.user.id, `Updated info for "${existing[0].name}".${cleanupNote}`);

//     const [rows] = await pool.query('SELECT * FROM sellers WHERE id = ?', [id]);
//     res.json(rows[0]);
//   } catch (err) {
//     await conn.rollback();
//     conn.release();
//     console.error(err);
//     res.status(500).json({ message: err.sqlMessage || err.message || 'Failed to update lead/seller.' });
//   }
// };








// const pool = require('../config/db');
// const logActivity = require('../utils/logActivity');
// const { assignAcquisitionAgent } = require('../utils/assignAgent');
// const { TASK_NAMES } = require('../utils/taskFlow');

// // Philippine mobile format: 09XXXXXXXXX (11 digits, starts with 09)
// const PH_PHONE_REGEX = /^09\d{9}$/;
// // Basic email shape check — good enough to catch typos without being overly strict
// const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// // Letters, spaces, and the punctuation that legitimately shows up in real names
// // (periods, hyphens, apostrophes) — blocks digits/symbols without being too restrictive
// const NAME_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ.'\- ]+$/;

// // Mirrors the enum() definitions on the `sellers` table exactly, so a bad value is caught
// // here with a clear message instead of surfacing as a raw MySQL error.
// const LEAD_SOURCES = ['Facebook', 'Website', 'Referral', 'TV', 'Walk-in', 'YouTube'];
// const SELLER_STATUSES = ['Active', 'Inactive', 'Invalid'];

// // Runs every check for name/phone/email/lead_source (and status, if provided) and returns
// // the first error message found, or null if everything is valid.
// function validateSellerFields({ name, phone, email, lead_source, status }) {
//   if (!name || !name.trim()) return 'Name is required.';
//   const trimmedName = name.trim();
//   if (trimmedName.length < 2) return 'Name must be at least 2 characters.';
//   if (trimmedName.length > 100) return 'Name must be 100 characters or fewer.';
//   if (!NAME_REGEX.test(trimmedName)) return 'Name can only contain letters, spaces, periods, hyphens, and apostrophes.';

//   if (!phone || !phone.trim()) return 'Phone number is required.';
//   if (!PH_PHONE_REGEX.test(phone.trim())) {
//     return 'Phone number must be 11 digits starting with 09 (e.g. 09123456789).';
//   }

//   if (email && email.trim()) {
//     if (email.trim().length > 150) return 'Email must be 150 characters or fewer.';
//     if (!EMAIL_REGEX.test(email.trim())) return 'Please enter a valid email address (e.g. name@example.com).';
//   }

//   if (!lead_source) return 'Lead source is required.';
//   if (!LEAD_SOURCES.includes(lead_source)) {
//     return `Lead source must be one of: ${LEAD_SOURCES.join(', ')}.`;
//   }

//   if (status !== undefined && status !== null && !SELLER_STATUSES.includes(status)) {
//     return `Status must be one of: ${SELLER_STATUSES.join(', ')}.`;
//   }

//   return null;
// }

// // GET /api/sellers
// exports.getAllSellers = async (req, res) => {
//   try {
//     const [rows] = await pool.query('SELECT * FROM sellers ORDER BY id DESC');
//     res.json(rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to load leads/sellers.' });
//   }
// };

// // POST /api/sellers  (Create Lead)
// exports.createSeller = async (req, res) => {
//   const conn = await pool.getConnection();
//   try {
//     const { name, phone, email, lead_source } = req.body;

//     const validationError = validateSellerFields({ name, phone, email, lead_source });
//     if (validationError) {
//       conn.release();
//       return res.status(400).json({ message: validationError });
//     }

//     await conn.beginTransaction();

//     // seller_type defaults to 'Lead', status defaults to 'Active' per schema
//     const [result] = await conn.query(
//       'INSERT INTO sellers (name, phone, email, lead_source) VALUES (?, ?, ?, ?)',
//       [name.trim(), phone.trim(), email ? email.trim() : '', lead_source]
//     );
//     const sellerId = result.insertId;

//     // Auto-create the first task: "Get Property Info" assigned to a Team Acquisition agent
//     const agent = await assignAcquisitionAgent();
//     const today = new Date().toISOString().slice(0, 10);
//     await conn.query(
//       `INSERT INTO tasks (task, seller_id, property_id, task_date, task_time, assigned_to, status)
//        VALUES (?, ?, NULL, ?, '09:00:00', ?, 'Not Done')`,
//       [TASK_NAMES.GET_PROPERTY_INFO, sellerId, today, agent.id]
//     );

//     // The seller shows up in the Pipeline module immediately, at "New Lead" — before any
//     // property exists. property_id starts NULL and gets attached once their first
//     // property is recorded (see propertyController.createProperty).
//     await conn.query(
//       "INSERT INTO sales_pipeline (seller_id, property_id, stage) VALUES (?, NULL, 'New Lead')",
//       [sellerId]
//     );

//     await conn.commit();
//     conn.release();

//     await logActivity(req.user.id, `New lead "${name.trim()}" was created and assigned to ${agent.name} for property info gathering.`);

//     const [rows] = await pool.query('SELECT * FROM sellers WHERE id = ?', [sellerId]);
//     res.status(201).json(rows[0]);
//   } catch (err) {
//     await conn.rollback();
//     conn.release();
//     console.error(err);
//     res.status(500).json({ message: err.sqlMessage || err.message || 'Failed to create lead.' });
//   }
// };

// // PUT /api/sellers/:id  (Update info — seller_type is NEVER editable manually)
// // If status is changed to "Inactive" or "Invalid", every task and pipeline entry tied to
// // this seller (across ALL their properties) is removed — they drop out of the Task and
// // Pipeline modules entirely. Their seller/property records themselves are left intact for
// // history; only the active task/pipeline tracking is cleared. This is a one-way cleanup:
// // flipping status back to "Active" later does NOT recreate anything automatically.
// exports.updateSeller = async (req, res) => {
//   const conn = await pool.getConnection();
//   try {
//     const { id } = req.params;
//     const { name, phone, email, lead_source, status } = req.body; // seller_type intentionally excluded

//     const validationError = validateSellerFields({ name, phone, email, lead_source, status });
//     if (validationError) {
//       conn.release();
//       return res.status(400).json({ message: validationError });
//     }

//     const [existing] = await conn.query('SELECT * FROM sellers WHERE id = ?', [id]);
//     if (existing.length === 0) {
//       conn.release();
//       return res.status(404).json({ message: 'Lead/Seller not found.' });
//     }

//     const finalStatus = status ?? existing[0].status;
//     const statusChanged = finalStatus !== existing[0].status;
//     const becameInactiveOrInvalid = statusChanged && (finalStatus === 'Inactive' || finalStatus === 'Invalid');

//     await conn.beginTransaction();

//     await conn.query(
//       'UPDATE sellers SET name = ?, phone = ?, email = ?, lead_source = ?, status = ? WHERE id = ?',
//       [
//         name.trim(),
//         phone.trim(),
//         email ? email.trim() : '',
//         lead_source,
//         finalStatus,
//         id
//       ]
//     );

//     let cleanupNote = '';
//     if (becameInactiveOrInvalid) {
//       const [taskDelResult] = await conn.query('DELETE FROM tasks WHERE seller_id = ?', [id]);
//       const [pipelineDelResult] = await conn.query('DELETE FROM sales_pipeline WHERE seller_id = ?', [id]);
//       cleanupNote = ` Status set to "${finalStatus}": removed ${taskDelResult.affectedRows} task(s) and ${pipelineDelResult.affectedRows} pipeline entr${pipelineDelResult.affectedRows === 1 ? 'y' : 'ies'}.`;
//     }

//     await conn.commit();
//     conn.release();

//     await logActivity(req.user.id, `Updated info for "${existing[0].name}".${cleanupNote}`);

//     const [rows] = await pool.query('SELECT * FROM sellers WHERE id = ?', [id]);
//     res.json(rows[0]);
//   } catch (err) {
//     await conn.rollback();
//     conn.release();
//     console.error(err);
//     res.status(500).json({ message: err.sqlMessage || err.message || 'Failed to update lead/seller.' });
//   }
// };






// const pool = require('../config/db');
// const logActivity = require('../utils/logActivity');
// const { assignAcquisitionAgent } = require('../utils/assignAgent');
// const { TASK_NAMES } = require('../utils/taskFlow');

// // Philippine mobile format: 09XXXXXXXXX (11 digits, starts with 09)
// const PH_PHONE_REGEX = /^09\d{9}$/;
// // Basic email shape check — good enough to catch typos without being overly strict
// const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// // Letters, spaces, and the punctuation that legitimately shows up in real names
// // (periods, hyphens, apostrophes) — blocks digits/symbols without being too restrictive
// const NAME_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ.'\- ]+$/;

// // Mirrors the enum() definitions on the `sellers` table exactly, so a bad value is caught
// // here with a clear message instead of surfacing as a raw MySQL error.
// const LEAD_SOURCES = ['Facebook', 'Website', 'Referral', 'TV', 'Walk-in', 'YouTube'];
// const SELLER_STATUSES = ['Active', 'Inactive', 'Invalid'];

// // Runs every check for name/phone/email/lead_source (and status, if provided) and returns
// // the first error message found, or null if everything is valid.
// function validateSellerFields({ name, phone, email, lead_source, status }) {
//   if (!name || !name.trim()) return "Input a seller's name.";
//   const trimmedName = name.trim();
//   if (trimmedName.length < 2) return 'Name must be at least 2 characters.';
//   if (trimmedName.length > 100) return 'Name must be 100 characters or fewer.';
//   if (!NAME_REGEX.test(trimmedName)) return 'Name can only contain letters, spaces, periods, hyphens, and apostrophes.';

//   if (!phone || !phone.trim()) return "Input a seller's contact.";
//   if (!PH_PHONE_REGEX.test(phone.trim())) {
//     return 'Phone number must be 11 digits starting with 09 (e.g. 09123456789).';
//   }

//   if (!email && !email.trim()) return "Input a seller's email.";
//   if (email && email.trim()) {
//     if (email.trim().length > 150) return 'Email must be 150 characters or fewer.';
//     if (!EMAIL_REGEX.test(email.trim())) return 'Please enter a valid email address (e.g. name@example.com).';
//   }

//   if (!lead_source) return 'Select a lead source';
//   if (!LEAD_SOURCES.includes(lead_source)) {
//     return `Lead source must be one of: ${LEAD_SOURCES.join(', ')}.`;
//   }

//   if (status !== undefined && status !== null && !SELLER_STATUSES.includes(status)) {
//     return `Status must be one of: ${SELLER_STATUSES.join(', ')}.`;
//   }

//   return null;
// }

// // GET /api/sellers
// exports.getAllSellers = async (req, res) => {
//   try {
//     const [rows] = await pool.query('SELECT * FROM sellers ORDER BY id DESC');
//     res.json(rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to load leads/sellers.' });
//   }
// };

// // POST /api/sellers  (Create Lead)
// exports.createSeller = async (req, res) => {
//   const conn = await pool.getConnection();
//   try {
//     const { name, phone, email, lead_source } = req.body;

//     const validationError = validateSellerFields({ name, phone, email, lead_source });
//     if (validationError) {
//       conn.release();
//       return res.status(400).json({ message: validationError });
//     }

//     await conn.beginTransaction();

//     // seller_type defaults to 'Lead', status defaults to 'Active' per schema
//     const [result] = await conn.query(
//       'INSERT INTO sellers (name, phone, email, lead_source) VALUES (?, ?, ?, ?)',
//       [name.trim(), phone.trim(), email ? email.trim() : '', lead_source]
//     );
//     const sellerId = result.insertId;

//     // Auto-create the first task: "Get Property Info" assigned to a Team Acquisition agent
//     const agent = await assignAcquisitionAgent();
//     const today = new Date().toISOString().slice(0, 10);
//     await conn.query(
//       `INSERT INTO tasks (task, seller_id, property_id, task_date, task_time, assigned_to, status)
//        VALUES (?, ?, NULL, ?, '09:00:00', ?, 'Not Done')`,
//       [TASK_NAMES.GET_PROPERTY_INFO, sellerId, today, agent.id]
//     );

//     // The seller shows up in the Pipeline module immediately, at "New Lead" — before any
//     // property exists. property_id starts NULL and gets attached once their first
//     // property is recorded (see propertyController.createProperty).
//     await conn.query(
//       "INSERT INTO sales_pipeline (seller_id, property_id, stage) VALUES (?, NULL, 'New Lead')",
//       [sellerId]
//     );

//     await conn.commit();
//     conn.release();

//     await logActivity(req.user.id, `New lead "${name.trim()}" was created and assigned to ${agent.name} for property info gathering.`);

//     const [rows] = await pool.query('SELECT * FROM sellers WHERE id = ?', [sellerId]);
//     res.status(201).json(rows[0]);
//   } catch (err) {
//     await conn.rollback();
//     conn.release();
//     console.error(err);
//     res.status(500).json({ message: err.sqlMessage || err.message || 'Failed to create lead.' });
//   }
// };

// // PUT /api/sellers/:id  (Update info — seller_type is NEVER editable manually)
// exports.updateSeller = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { name, phone, email, lead_source, status } = req.body; // seller_type intentionally excluded

//     const validationError = validateSellerFields({ name, phone, email, lead_source, status });
//     if (validationError) {
//       return res.status(400).json({ message: validationError });
//     }

//     const [existing] = await pool.query('SELECT * FROM sellers WHERE id = ?', [id]);
//     if (existing.length === 0) {
//       return res.status(404).json({ message: 'Lead/Seller not found.' });
//     }

//     await pool.query(
//       'UPDATE sellers SET name = ?, phone = ?, email = ?, lead_source = ?, status = ? WHERE id = ?',
//       [
//         name.trim(),
//         phone.trim(),
//         email ? email.trim() : '',
//         lead_source,
//         status ?? existing[0].status,
//         id
//       ]
//     );

//     await logActivity(req.user.id, `Updated info for "${existing[0].name}".`);

//     const [rows] = await pool.query('SELECT * FROM sellers WHERE id = ?', [id]);
//     res.json(rows[0]);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: err.sqlMessage || err.message || 'Failed to update lead/seller.' });
//   }
// };















// const pool = require('../config/db');
// const logActivity = require('../utils/logActivity');
// const { assignAcquisitionAgent } = require('../utils/assignAgent');
// const { TASK_NAMES } = require('../utils/taskFlow');
// const { validatePhone, validateEmail, validateRequiredText, firstError } = require('../utils/validators');

// // // Philippine mobile format: 09XXXXXXXXX (11 digits, starts with 09)
// const PH_PHONE_REGEX = /^09\d{9}$/;

// // GET /api/sellers
// exports.getAllSellers = async (req, res) => {
//   try {
//     const [rows] = await pool.query('SELECT * FROM sellers ORDER BY id DESC');
//     res.json(rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to load leads/sellers.' });
//   }
// };

// // POST /api/sellers  (Create Lead)
// exports.createSeller = async (req, res) => {
//   const conn = await pool.getConnection();
//   try {
//        const { name, phone, email, lead_source } = req.body;
//     if (!name || !phone || !email || !lead_source) {
//       conn.release();
//       return res.status(400).json({ message: 'Name, phone, email, and lead source are required.' });
//     }
//     if (!PH_PHONE_REGEX.test(phone.trim())) {
//       conn.release();
//       return res.status(400).json({ message: 'Phone number must be 11 digits starting with 09 (e.g. 09123456789).' });
//     }

//     await conn.beginTransaction();

//     // seller_type defaults to 'Lead', status defaults to 'Active' per schema. email is optional.
//     const [result] = await conn.query(
//       'INSERT INTO sellers (name, phone, email, lead_source) VALUES (?, ?, ?, ?)',
//       [name, phone, email || '', lead_source]
//     );
//     const sellerId = result.insertId;

//     // Auto-create the first task: "Get Property Info" assigned to a Team Acquisition agent
//     const agent = await assignAcquisitionAgent();
//     const today = new Date().toISOString().slice(0, 10);
//     await conn.query(
//       `INSERT INTO tasks (task, seller_id, property_id, task_date, task_time, assigned_to, status)
//        VALUES (?, ?, NULL, ?, '09:00:00', ?, 'Not Done')`,
//       [TASK_NAMES.GET_PROPERTY_INFO, sellerId, today, agent.id]
//     );

//     // The seller shows up in the Pipeline module immediately, at "New Lead" — before any
//     // property exists. property_id starts NULL and gets attached once their first
//     // property is recorded (see propertyController.createProperty).
//     await conn.query(
//       "INSERT INTO sales_pipeline (seller_id, property_id, stage) VALUES (?, NULL, 'New Lead')",
//       [sellerId]
//     );

//     await conn.commit();
//     conn.release();

//     await logActivity(req.user.id, `New lead "${name}" was created and assigned to ${agent.name} for property info gathering.`);

//     const [rows] = await pool.query('SELECT * FROM sellers WHERE id = ?', [sellerId]);
//     res.status(201).json(rows[0]);
//   } catch (err) {
//     await conn.rollback();
//     conn.release();
//     console.error(err);
//     res.status(500).json({ message: err.message || 'Failed to create lead.' });
//   }
// };

// // PUT /api/sellers/:id  (Update info — seller_type is NEVER editable manually)
// exports.updateSeller = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { name, phone, email, lead_source, status } = req.body; // seller_type intentionally excluded

//     const [existing] = await pool.query('SELECT * FROM sellers WHERE id = ?', [id]);
//     if (existing.length === 0) {
//       return res.status(404).json({ message: 'Lead/Seller not found.' });
//     }

//     const finalPhone = phone ?? existing[0].phone;
//     const finalEmail = (email ?? existing[0].email) ?? '';
//     const finalName = name ?? existing[0].name;

//     const validationError = firstError([
//       [validateRequiredText, finalName, 'Name'],
//       [validatePhone, finalPhone],
//       [validateEmail, finalEmail]
//     ]);
//     if (validationError) {
//       return res.status(400).json({ message: validationError });
//     }

//     await pool.query(
//       'UPDATE sellers SET name = ?, phone = ?, email = ?, lead_source = ?, status = ? WHERE id = ?',
//       [
//         finalName,
//         finalPhone,
//         finalEmail,
//         lead_source ?? existing[0].lead_source,
//         status ?? existing[0].status,
//         id
//       ]
//     );

//     await logActivity(req.user.id, `Updated info for "${existing[0].name}".`);

//     const [rows] = await pool.query('SELECT * FROM sellers WHERE id = ?', [id]);
//     res.json(rows[0]);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: err.sqlMessage || err.message || 'Failed to update lead/seller.' });
//   }
// };








// const pool = require('../config/db');
// const logActivity = require('../utils/logActivity');
// const { assignAcquisitionAgent } = require('../utils/assignAgent');
// const { TASK_NAMES } = require('../utils/taskFlow');

// // Philippine mobile format: 09XXXXXXXXX (11 digits, starts with 09)
// const PH_PHONE_REGEX = /^09\d{9}$/;

// // GET /api/sellers
// exports.getAllSellers = async (req, res) => {
//   try {
//     const [rows] = await pool.query('SELECT * FROM sellers ORDER BY id DESC');
//     res.json(rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to load leads/sellers.' });
//   }
// };

// // POST /api/sellers  (Create Lead)
// exports.createSeller = async (req, res) => {
//   const conn = await pool.getConnection();
//   try {
//     const { name, phone, email, lead_source } = req.body;
//     // if (!name || !phone || !email || !lead_source) {
//     //   conn.release();
//     //   return res.status(400).json({ message: 'Name, phone, email, and lead source are required.' });
//     // }
//     // if (!PH_PHONE_REGEX.test(phone.trim())) {
//     //   conn.release();
//     //   return res.status(400).json({ message: 'Phone number must be 11 digits starting with 09 (e.g. 09123456789).' });
//     // }

//     await conn.beginTransaction();

//     // seller_type defaults to 'Lead', status defaults to 'Active' per schema
//     const [result] = await conn.query(
//       'INSERT INTO sellers (name, phone, email, lead_source) VALUES (?, ?, ?, ?)',
//       [name, phone, email, lead_source]
//     );
//     const sellerId = result.insertId;

//     // Auto-create the first task: "Get Property Info" assigned to a Team Acquisition agent
//     const agent = await assignAcquisitionAgent();
//     const today = new Date().toISOString().slice(0, 10);
//     await conn.query(
//       `INSERT INTO tasks (task, seller_id, property_id, task_date, task_time, assigned_to, status)
//        VALUES (?, ?, NULL, ?, '09:00:00', ?, 'Not Done')`,
//       [TASK_NAMES.GET_PROPERTY_INFO, sellerId, today, agent.id]
//     );

//     await conn.commit();
//     conn.release();

//     await logActivity(req.user.id, `New lead "${name}" was created and assigned to ${agent.name} for property info gathering.`);

//     const [rows] = await pool.query('SELECT * FROM sellers WHERE id = ?', [sellerId]);
//     res.status(201).json(rows[0]);
//   } catch (err) {
//     await conn.rollback();
//     conn.release();
//     console.error(err);
//     res.status(500).json({ message: err.sqlMessage || err.message || 'Failed to create lead.' });
//   }
// };

// // PUT /api/sellers/:id  (Update info — seller_type is NEVER editable manually)
// exports.updateSeller = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { name, phone, email, lead_source, status } = req.body; // seller_type intentionally excluded

//     if (!name || !phone || !email || !lead_source) {
//       return res.status(400).json({ message: 'Name, phone, email, and lead source are required.' });
//     }
//     if (!PH_PHONE_REGEX.test(phone.trim())) {
//       return res.status(400).json({ message: 'Phone number must be 11 digits starting with 09 (e.g. 09123456789).' });
//     }

//     const [existing] = await pool.query('SELECT * FROM sellers WHERE id = ?', [id]);
//     if (existing.length === 0) {
//       return res.status(404).json({ message: 'Lead/Seller not found.' });
//     }

//     await pool.query(
//       'UPDATE sellers SET name = ?, phone = ?, email = ?, lead_source = ?, status = ? WHERE id = ?',
//       [
//         name,
//         phone,
//         email,
//         lead_source,
//         status ?? existing[0].status,
//         id
//       ]
//     );

//     await logActivity(req.user.id, `Updated info for "${existing[0].name}".`);

//     const [rows] = await pool.query('SELECT * FROM sellers WHERE id = ?', [id]);
//     res.json(rows[0]);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: err.sqlMessage || err.message || 'Failed to update lead/seller.' });
//   }
// };