const pool = require('../config/db');
const logActivity = require('../utils/logActivity');
const { assignAgentForState } = require('../utils/assignAgent');
const { TASK_NAMES, TASK_FLOW } = require('../utils/taskFlow');
const { closeDealWon, closeDealLost, reopenDeal } = require('../utils/dealLifecycle');
const { getNextDayDateString, getRandomAvailableTimeSlot } = require('../utils/scheduling');

// Mirrors the enum() definitions on the `properties` table exactly, so a bad value is
// caught here with a clear message instead of surfacing as a raw MySQL error.
const STATES = ['Texas', 'Florida'];
const PROPERTY_TYPES = ['House', 'Apartment', 'Office', 'Shop', 'Hotel', 'Warehouse'];
const PROPERTY_CONDITIONS = ['Excellent', 'Good', 'Needs Repairs', 'Bad'];
const PROPERTY_STATUSES = ['On Process', 'Complete', 'Cancelled'];

// Sequential, field-by-field validation — same style as sellerController.validateSellerFields.
// Checks run in the same order the fields appear on the form (after Seller, which is
// checked separately since it needs a DB lookup — see createProperty). Returns the first
// error message found, or null if everything is valid. `status` is optional since it's
// only ever supplied on update.
function validatePropertyFields({
  property_address, state, county, room, bathrooms,
  market_value, property_type, property_condition, status
}) {
  if (!property_address || !property_address.trim()) return 'Input the property address.';
  if (property_address.trim().length > 255) return 'Property address must be 255 characters or fewer.';

  if (!state) return 'Select a state.';
  if (!STATES.includes(state)) return `State must be one of: ${STATES.join(', ')}.`;

  if (!county || !county.trim()) return 'Input the county.';
  if (county.trim().length > 100) return 'County must be 100 characters or fewer.';

  if (room === undefined || room === null || room === '') return 'Input the number of rooms.';
  const roomNum = Number(room);
  if (Number.isNaN(roomNum)) return 'Rooms must be a number.';
  if (roomNum < 0) return 'Rooms cannot be negative.';
  if (roomNum > 100) return 'Rooms seems too high (max 100).';

  if (bathrooms === undefined || bathrooms === null || bathrooms === '') return 'Input the number of bathrooms.';
  const bathroomsNum = Number(bathrooms);
  if (Number.isNaN(bathroomsNum)) return 'Bathrooms must be a number.';
  if (bathroomsNum < 0) return 'Bathrooms cannot be negative.';
  if (bathroomsNum > 100) return 'Bathrooms seems too high (max 100).';

  if (market_value !== undefined && market_value !== null && market_value !== '') {
    const marketValueNum = Number(market_value);
    if (Number.isNaN(marketValueNum)) return 'Market value must be a number.';
    if (marketValueNum < 0) return 'Market value cannot be negative.';
    if (marketValueNum > 999999999.99) return 'Market value seems too high (max 999,999,999.99).';
  }

  if (!property_type) return 'Select a property type.';
  if (!PROPERTY_TYPES.includes(property_type)) return `Property type must be one of: ${PROPERTY_TYPES.join(', ')}.`;

  if (!property_condition) return 'Select a property condition.';
  if (!PROPERTY_CONDITIONS.includes(property_condition)) {
    return `Property condition must be one of: ${PROPERTY_CONDITIONS.join(', ')}.`;
  }

  if (status !== undefined && status !== null && !PROPERTY_STATUSES.includes(status)) {
    return `Status must be one of: ${PROPERTY_STATUSES.join(', ')}.`;
  }

  return null;
}

// GET /api/properties  (joined with seller name, employee/agent name & team, pipeline stage)
exports.getAllProperties = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        p.*,
        s.name AS seller_name,
        e.name AS agent_name,
        e.team AS team,
        sp.stage AS stage
      FROM properties p
      JOIN sellers s ON s.id = p.seller_id
      JOIN employees e ON e.id = p.employee_id
      LEFT JOIN sales_pipeline sp ON sp.property_id = p.id
      ORDER BY p.id DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load properties.' });
  }
};

// GET /api/properties/sellers-without-property  (for the "Seller" dropdown on Add Property)
exports.getSellersForDropdown = async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name FROM sellers WHERE status = 'Active' ORDER BY name ASC"
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load sellers.' });
  }
};

// POST /api/properties  (Add Property)
exports.createProperty = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const {
      seller_id, property_address, state, county,
      room, bathrooms, market_value, property_type, property_condition
    } = req.body;

    // 1. Seller is checked FIRST, since it's the first field on the form and every other
    // field depends on a valid seller existing.
    if (!seller_id) {
      conn.release();
      return res.status(400).json({ message: 'Select a seller.' });
    }
    const [sellerCheckRows] = await conn.query('SELECT id, name FROM sellers WHERE id = ?', [seller_id]);
    if (sellerCheckRows.length === 0) {
      conn.release();
      return res.status(400).json({ message: 'Selected seller does not exist.' });
    }

    // 2. Then everything else, in form order.
    const validationError = validatePropertyFields({
      property_address, state, county, room, bathrooms, market_value, property_type, property_condition
    });
    if (validationError) {
      conn.release();
      return res.status(400).json({ message: validationError });
    }

    await conn.beginTransaction();

    // 1. Auto-assign team/agent based on state
    const agent = await assignAgentForState(state);

    // 2. Insert property (status defaults to 'On Process')
    const [result] = await conn.query(
      `INSERT INTO properties
       (seller_id, employee_id, property_address, state, county, room, bathrooms, market_value, property_type, property_condition)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [seller_id, agent.id, property_address, state, county, room || 0, bathrooms || 0, market_value || 0, property_type, property_condition]
    );
    const propertyId = result.insertId;

    // "Get Property Info" is being completed by recording this property — read what
    // TASK_FLOW says should happen next (stage + next task) instead of hardcoding it, so
    // this stays in sync if TASK_FLOW.js is ever changed (e.g. adding a "Qualified" step).
    const gpiFlow = TASK_FLOW[TASK_NAMES.GET_PROPERTY_INFO] || {};
    const initialStage = gpiFlow.nextStage || 'New Lead';
    const nextTaskName = gpiFlow.nextTask || TASK_NAMES.REVIEW_PROPERTY_INFO;

    // 3. Attach this property to the pipeline. Every seller already has a pipeline entry
    // created at "New Lead" the moment they registered (see sellerController.createSeller).
    // If this is their FIRST property, reuse that existing entry (attach property_id to
    // it). If they already have other properties (each with their own pipeline entry),
    // this is an additional property — give it a fresh pipeline entry.
    const [unattachedPipelineRows] = await conn.query(
      'SELECT id FROM sales_pipeline WHERE seller_id = ? AND property_id IS NULL LIMIT 1',
      [seller_id]
    );
    if (unattachedPipelineRows.length > 0) {
      await conn.query(
        'UPDATE sales_pipeline SET property_id = ?, stage = ? WHERE id = ?',
        [propertyId, initialStage, unattachedPipelineRows[0].id]
      );
    } else {
      await conn.query(
        'INSERT INTO sales_pipeline (seller_id, property_id, stage) VALUES (?, ?, ?)',
        [seller_id, propertyId, initialStage]
      );
    }

    // 4. Complete the earlier "Get Property Info" task for this seller, if still open
    await conn.query(
      `UPDATE tasks SET status = 'Done'
       WHERE seller_id = ? AND task = ? AND property_id IS NULL AND status = 'Not Done'`,
      [seller_id, TASK_NAMES.GET_PROPERTY_INFO]
    );

    // 5. Auto-create the next task in the chain, assigned to the property's agent
    const dueDate = getNextDayDateString();
    const dueTime = await getRandomAvailableTimeSlot(conn, agent.id, dueDate);
    await conn.query(
      `INSERT INTO tasks (task, seller_id, property_id, task_date, task_time, assigned_to, status)
       VALUES (?, ?, ?, ?, ?, ?, 'Not Done')`,
      [nextTaskName, seller_id, propertyId, dueDate, dueTime, agent.id]
    );

    await conn.commit();
    conn.release();

    await logActivity(
      req.user.id,
      `Property "${property_address}" for seller "${sellerCheckRows[0].name}" was recorded and routed to ${agent.team} (${agent.name}).`
    );

    const [rows] = await pool.query(
      `SELECT p.*, s.name AS seller_name, e.name AS agent_name, e.team AS team, sp.stage AS stage
       FROM properties p
       JOIN sellers s ON s.id = p.seller_id
       JOIN employees e ON e.id = p.employee_id
       LEFT JOIN sales_pipeline sp ON sp.property_id = p.id
       WHERE p.id = ?`,
      [propertyId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error(err);
    res.status(500).json({ message: err.sqlMessage || err.message || 'Failed to create property.' });
  }
};

// PUT /api/properties/:id  (Edit Property — re-routes team/agent if state changes, and drives
// the deal-lifecycle automation described below when `status` changes)
//
// Status lifecycle automation:
//   -> 'Complete'    : deal is WON.  Delete ALL tasks tied to this property, set pipeline
//                      stage to 'Closed - Won'.
//   -> 'Cancelled'   : deal is LOST. Delete ALL tasks tied to this property, set pipeline
//                      stage to 'Closed - Lost'.
//   -> 'On Process'  : deal is REOPENED (only meaningful coming from Complete/Cancelled).
//                      Delete any leftover tasks, reset pipeline stage to 'New Lead', and
//                      recreate a fresh "Review Property Info" task so the deal starts over
//                      exactly where it would after the property was first recorded.
// The seller-level "Get Property Info" task is never touched here, since it isn't tied to
// this property_id at all (it's created with property_id = NULL).
exports.updateProperty = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const {
      property_address, state, county, room, bathrooms,
      market_value, property_type, property_condition, status
    } = req.body;

    const [existingRows] = await conn.query('SELECT * FROM properties WHERE id = ?', [id]);
    if (existingRows.length === 0) {
      conn.release();
      return res.status(404).json({ message: 'Property not found.' });
    }
    const existing = existingRows[0];

    const finalAddress = property_address ?? existing.property_address;
    const finalCounty = county ?? existing.county;
    const finalRoom = room ?? existing.room;
    const finalBathrooms = bathrooms ?? existing.bathrooms;
    const finalMarketValue = market_value ?? existing.market_value;
    const finalStatus = status ?? existing.status;
    const finalState = state ?? existing.state;
    const finalPropertyType = property_type ?? existing.property_type;
    const finalPropertyCondition = property_condition ?? existing.property_condition;

    const validationError = validatePropertyFields({
      property_address: finalAddress,
      state: finalState,
      county: finalCounty,
      room: finalRoom,
      bathrooms: finalBathrooms,
      market_value: finalMarketValue,
      property_type: finalPropertyType,
      property_condition: finalPropertyCondition,
      status: finalStatus
    });
    if (validationError) {
      conn.release();
      return res.status(400).json({ message: validationError });
    }

    let employeeId = existing.employee_id;
    let reassignedNote = '';
    if (state && state !== existing.state) {
      const agent = await assignAgentForState(state);
      employeeId = agent.id;
      reassignedNote = ` Re-routed to ${agent.team} (${agent.name}) due to state change.`;
    }

    await conn.beginTransaction();

    await conn.query(
      `UPDATE properties SET
        property_address = ?, state = ?, county = ?, room = ?, bathrooms = ?,
        market_value = ?, property_type = ?, property_condition = ?, status = ?, employee_id = ?
       WHERE id = ?`,
      [
        finalAddress,
        state ?? existing.state,
        finalCounty,
        finalRoom,
        finalBathrooms,
        finalMarketValue,
        property_type ?? existing.property_type,
        property_condition ?? existing.property_condition,
        finalStatus,
        employeeId,
        id
      ]
    );

    let lifecycleNote = '';
    const statusChanged = finalStatus !== existing.status;

    if (statusChanged && finalStatus === 'Complete') {
      lifecycleNote = await closeDealWon(conn, { sellerId: existing.seller_id, propertyId: id });
    } else if (statusChanged && finalStatus === 'Cancelled') {
      lifecycleNote = await closeDealLost(conn, { sellerId: existing.seller_id, propertyId: id });
    } else if (statusChanged && finalStatus === 'On Process') {
      lifecycleNote = await reopenDeal(conn, { sellerId: existing.seller_id, propertyId: id, employeeId });
    }

    await conn.commit();
    conn.release();

    const [sellerRows] = await pool.query('SELECT name FROM sellers WHERE id = ?', [existing.seller_id]);
    const sellerName = sellerRows[0]?.name || 'Unknown Seller';
    await logActivity(req.user.id, `Updated property "${existing.property_address}" for seller "${sellerName}".${reassignedNote}${lifecycleNote}`);

    const [rows] = await pool.query(
      `SELECT p.*, s.name AS seller_name, e.name AS agent_name, e.team AS team, sp.stage AS stage
       FROM properties p
       JOIN sellers s ON s.id = p.seller_id
       JOIN employees e ON e.id = p.employee_id
       LEFT JOIN sales_pipeline sp ON sp.property_id = p.id
       WHERE p.id = ?`,
      [id]
    );
    res.json(rows[0]);
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error(err);
    res.status(500).json({ message: err.sqlMessage || err.message || 'Failed to update property.' });
  }
};




// const pool = require('../config/db');
// const logActivity = require('../utils/logActivity');
// const { assignAgentForState } = require('../utils/assignAgent');
// const { TASK_NAMES, TASK_FLOW } = require('../utils/taskFlow');
// const { closeDealWon, closeDealLost, reopenDeal } = require('../utils/dealLifecycle');
// const { getNextDayDateString, getRandomAvailableTimeSlot } = require('../utils/scheduling');

// // Mirrors the enum() definitions on the `properties` table exactly, so a bad value is
// // caught here with a clear message instead of surfacing as a raw MySQL error.
// const STATES = ['Texas', 'Florida'];
// const PROPERTY_TYPES = ['House', 'Apartment', 'Office', 'Shop', 'Hotel', 'Warehouse'];
// const PROPERTY_CONDITIONS = ['Excellent', 'Good', 'Needs Repairs', 'Bad'];
// const PROPERTY_STATUSES = ['On Process', 'Complete', 'Cancelled'];

// // Sequential, field-by-field validation — same style as sellerController.validateSellerFields.
// // Checks run in the same order the fields appear on the form (after Seller, which is
// // checked separately since it needs a DB lookup — see createProperty). Returns the first
// // error message found, or null if everything is valid. `status` is optional since it's
// // only ever supplied on update.
// function validatePropertyFields({
//   property_address, state, county, room, bathrooms,
//   market_value, property_type, property_condition, status
// }) {
//   if (!property_address || !property_address.trim()) return 'Input the property address.';
//   if (property_address.trim().length > 255) return 'Property address must be 255 characters or fewer.';

//   if (!state) return 'Select a state.';
//   if (!STATES.includes(state)) return `State must be one of: ${STATES.join(', ')}.`;

//   if (!county || !county.trim()) return 'Input the county.';
//   if (county.trim().length > 100) return 'County must be 100 characters or fewer.';

//   if (room === undefined || room === null || room === '') return 'Input the number of rooms.';
//   const roomNum = Number(room);
//   if (Number.isNaN(roomNum)) return 'Rooms must be a number.';
//   if (roomNum < 0) return 'Rooms cannot be negative.';
//   if (roomNum > 100) return 'Rooms seems too high (max 100).';

//   if (bathrooms === undefined || bathrooms === null || bathrooms === '') return 'Input the number of bathrooms.';
//   const bathroomsNum = Number(bathrooms);
//   if (Number.isNaN(bathroomsNum)) return 'Bathrooms must be a number.';
//   if (bathroomsNum < 0) return 'Bathrooms cannot be negative.';
//   if (bathroomsNum > 100) return 'Bathrooms seems too high (max 100).';

//   if (market_value === undefined || market_value === null || market_value === '') return 'Input the market value.';
//   if (market_value !== undefined && market_value !== null && market_value !== '') {
//     const marketValueNum = Number(market_value);
//     if (Number.isNaN(marketValueNum)) return 'Market value must be a number.';
//     if (marketValueNum < 0) return 'Market value cannot be negative.';
//     if (marketValueNum > 999999999.99) return 'Market value seems too high (max 999,999,999.99).';
//   }

//   if (!property_type) return 'Select a property type.';
//   if (!PROPERTY_TYPES.includes(property_type)) return `Property type must be one of: ${PROPERTY_TYPES.join(', ')}.`;

//   if (!property_condition) return 'Select a property condition.';
//   if (!PROPERTY_CONDITIONS.includes(property_condition)) {
//     return `Property condition must be one of: ${PROPERTY_CONDITIONS.join(', ')}.`;
//   }

//   if (status !== undefined && status !== null && !PROPERTY_STATUSES.includes(status)) {
//     return `Status must be one of: ${PROPERTY_STATUSES.join(', ')}.`;
//   }

//   return null;
// }

// // GET /api/properties  (joined with seller name, employee/agent name & team, pipeline stage)
// exports.getAllProperties = async (req, res) => {
//   try {
//     const [rows] = await pool.query(`
//       SELECT
//         p.*,
//         s.name AS seller_name,
//         e.name AS agent_name,
//         e.team AS team,
//         sp.stage AS stage
//       FROM properties p
//       JOIN sellers s ON s.id = p.seller_id
//       JOIN employees e ON e.id = p.employee_id
//       LEFT JOIN sales_pipeline sp ON sp.property_id = p.id
//       ORDER BY p.id DESC
//     `);
//     res.json(rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to load properties.' });
//   }
// };

// // GET /api/properties/sellers-without-property  (for the "Seller" dropdown on Add Property)
// exports.getSellersForDropdown = async (req, res) => {
//   try {
//     const [rows] = await pool.query(
//       "SELECT id, name FROM sellers WHERE status = 'Active' ORDER BY name ASC"
//     );
//     res.json(rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to load sellers.' });
//   }
// };

// // POST /api/properties  (Add Property)
// exports.createProperty = async (req, res) => {
//   const conn = await pool.getConnection();
//   try {
//     const {
//       seller_id, property_address, state, county,
//       room, bathrooms, market_value, property_type, property_condition
//     } = req.body;

//     // 1. Seller is checked FIRST, since it's the first field on the form and every other
//     // field depends on a valid seller existing.
//     if (!seller_id) {
//       conn.release();
//       return res.status(400).json({ message: 'Select a seller.' });
//     }
//     const [sellerCheckRows] = await conn.query('SELECT id FROM sellers WHERE id = ?', [seller_id]);
//     if (sellerCheckRows.length === 0) {
//       conn.release();
//       return res.status(400).json({ message: 'Selected seller does not exist.' });
//     }

//     // 2. Then everything else, in form order.
//     const validationError = validatePropertyFields({
//       property_address, state, county, room, bathrooms, market_value, property_type, property_condition
//     });
//     if (validationError) {
//       conn.release();
//       return res.status(400).json({ message: validationError });
//     }

//     await conn.beginTransaction();

//     // 1. Auto-assign team/agent based on state
//     const agent = await assignAgentForState(state);

//     // 2. Insert property (status defaults to 'On Process')
//     const [result] = await conn.query(
//       `INSERT INTO properties
//        (seller_id, employee_id, property_address, state, county, room, bathrooms, market_value, property_type, property_condition)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [seller_id, agent.id, property_address, state, county, room || 0, bathrooms || 0, market_value || 0, property_type, property_condition]
//     );
//     const propertyId = result.insertId;

//     // "Get Property Info" is being completed by recording this property — read what
//     // TASK_FLOW says should happen next (stage + next task) instead of hardcoding it, so
//     // this stays in sync if TASK_FLOW.js is ever changed.
//     const gpiFlow = TASK_FLOW[TASK_NAMES.GET_PROPERTY_INFO] || {};
//     const initialStage = gpiFlow.nextStage || 'New Lead';
//     const nextTaskName = gpiFlow.nextTask || TASK_NAMES.REVIEW_PROPERTY_INFO;

//     // 4. Attach this property to the pipeline. Every seller already has a pipeline entry
//     // created at "New Lead" the moment they registered (see sellerController.createSeller).
//     // If this is their FIRST property, reuse that existing entry (attach property_id to
//     // it). If they already have other properties (each with their own pipeline entry),
//     // this is an additional property — give it a fresh pipeline entry.
//     const [unattachedPipelineRows] = await conn.query(
//       'SELECT id FROM sales_pipeline WHERE seller_id = ? AND property_id IS NULL LIMIT 1',
//       [seller_id]
//     );
//     if (unattachedPipelineRows.length > 0) {
//       await conn.query(
//         'UPDATE sales_pipeline SET property_id = ?, stage = ? WHERE id = ?',
//         [propertyId, initialStage, unattachedPipelineRows[0].id]
//       );
//     } else {
//       await conn.query(
//         'INSERT INTO sales_pipeline (seller_id, property_id, stage) VALUES (?, ?, ?)',
//         [seller_id, propertyId, initialStage]
//       );
//     }

//     // 5. Complete the earlier "Get Property Info" task for this seller, if still open
//     await conn.query(
//       `UPDATE tasks SET status = 'Done'
//        WHERE seller_id = ? AND task = ? AND property_id IS NULL AND status = 'Not Done'`,
//       [seller_id, TASK_NAMES.GET_PROPERTY_INFO]
//     );

//     // 6. Auto-create the next task in the chain, assigned to the property's agent
//     const dueDate = getNextDayDateString();
//     const dueTime = await getRandomAvailableTimeSlot(conn, agent.id, dueDate);
//     await conn.query(
//       `INSERT INTO tasks (task, seller_id, property_id, task_date, task_time, assigned_to, status)
//        VALUES (?, ?, ?, ?, ?, ?, 'Not Done')`,
//       [nextTaskName, seller_id, propertyId, dueDate, dueTime, agent.id]
//     );

//     await conn.commit();
//     conn.release();

//     await logActivity(
//       req.user.id,
//       `Property "${property_address}" was recorded and routed to ${agent.team} (${agent.name}).`
//     );

//     const [rows] = await pool.query(
//       `SELECT p.*, s.name AS seller_name, e.name AS agent_name, e.team AS team, sp.stage AS stage
//        FROM properties p
//        JOIN sellers s ON s.id = p.seller_id
//        JOIN employees e ON e.id = p.employee_id
//        LEFT JOIN sales_pipeline sp ON sp.property_id = p.id
//        WHERE p.id = ?`,
//       [propertyId]
//     );
//     res.status(201).json(rows[0]);
//   } catch (err) {
//     await conn.rollback();
//     conn.release();
//     console.error(err);
//     res.status(500).json({ message: err.sqlMessage || err.message || 'Failed to create property.' });
//   }
// };

// // PUT /api/properties/:id  (Edit Property — re-routes team/agent if state changes, and drives
// // the deal-lifecycle automation described below when `status` changes)
// //
// // Status lifecycle automation:
// //   -> 'Complete'    : deal is WON.  Delete ALL tasks tied to this property, set pipeline
// //                      stage to 'Closed - Won'.
// //   -> 'Cancelled'   : deal is LOST. Delete ALL tasks tied to this property, set pipeline
// //                      stage to 'Closed - Lost'.
// //   -> 'On Process'  : deal is REOPENED (only meaningful coming from Complete/Cancelled).
// //                      Delete any leftover tasks, reset pipeline stage to 'New Lead', and
// //                      recreate a fresh "Review Property Info" task so the deal starts over
// //                      exactly where it would after the property was first recorded.
// // The seller-level "Get Property Info" task is never touched here, since it isn't tied to
// // this property_id at all (it's created with property_id = NULL).
// exports.updateProperty = async (req, res) => {
//   const conn = await pool.getConnection();
//   try {
//     const { id } = req.params;
//     const {
//       property_address, state, county, room, bathrooms,
//       market_value, property_type, property_condition, status
//     } = req.body;

//     const [existingRows] = await conn.query('SELECT * FROM properties WHERE id = ?', [id]);
//     if (existingRows.length === 0) {
//       conn.release();
//       return res.status(404).json({ message: 'Property not found.' });
//     }
//     const existing = existingRows[0];

//     const finalAddress = property_address ?? existing.property_address;
//     const finalCounty = county ?? existing.county;
//     const finalRoom = room ?? existing.room;
//     const finalBathrooms = bathrooms ?? existing.bathrooms;
//     const finalMarketValue = market_value ?? existing.market_value;
//     const finalStatus = status ?? existing.status;
//     const finalState = state ?? existing.state;
//     const finalPropertyType = property_type ?? existing.property_type;
//     const finalPropertyCondition = property_condition ?? existing.property_condition;

//     const validationError = validatePropertyFields({
//       property_address: finalAddress,
//       state: finalState,
//       county: finalCounty,
//       room: finalRoom,
//       bathrooms: finalBathrooms,
//       market_value: finalMarketValue,
//       property_type: finalPropertyType,
//       property_condition: finalPropertyCondition,
//       status: finalStatus
//     });
//     if (validationError) {
//       conn.release();
//       return res.status(400).json({ message: validationError });
//     }

//     let employeeId = existing.employee_id;
//     let reassignedNote = '';
//     if (state && state !== existing.state) {
//       const agent = await assignAgentForState(state);
//       employeeId = agent.id;
//       reassignedNote = ` Re-routed to ${agent.team} (${agent.name}) due to state change.`;
//     }

//     await conn.beginTransaction();

//     await conn.query(
//       `UPDATE properties SET
//         property_address = ?, state = ?, county = ?, room = ?, bathrooms = ?,
//         market_value = ?, property_type = ?, property_condition = ?, status = ?, employee_id = ?
//        WHERE id = ?`,
//       [
//         finalAddress,
//         state ?? existing.state,
//         finalCounty,
//         finalRoom,
//         finalBathrooms,
//         finalMarketValue,
//         property_type ?? existing.property_type,
//         property_condition ?? existing.property_condition,
//         finalStatus,
//         employeeId,
//         id
//       ]
//     );

//     let lifecycleNote = '';
//     const statusChanged = finalStatus !== existing.status;

//     if (statusChanged && finalStatus === 'Complete') {
//       lifecycleNote = await closeDealWon(conn, { sellerId: existing.seller_id, propertyId: id });
//     } else if (statusChanged && finalStatus === 'Cancelled') {
//       lifecycleNote = await closeDealLost(conn, { sellerId: existing.seller_id, propertyId: id });
//     } else if (statusChanged && finalStatus === 'On Process') {
//       lifecycleNote = await reopenDeal(conn, { sellerId: existing.seller_id, propertyId: id, employeeId });
//     }

//     await conn.commit();
//     conn.release();

//     await logActivity(req.user.id, `Updated property "${existing.property_address}".${reassignedNote}${lifecycleNote}`);

//     const [rows] = await pool.query(
//       `SELECT p.*, s.name AS seller_name, e.name AS agent_name, e.team AS team, sp.stage AS stage
//        FROM properties p
//        JOIN sellers s ON s.id = p.seller_id
//        JOIN employees e ON e.id = p.employee_id
//        LEFT JOIN sales_pipeline sp ON sp.property_id = p.id
//        WHERE p.id = ?`,
//       [id]
//     );
//     res.json(rows[0]);
//   } catch (err) {
//     await conn.rollback();
//     conn.release();
//     console.error(err);
//     res.status(500).json({ message: err.sqlMessage || err.message || 'Failed to update property.' });
//   }
// };























// const pool = require('../config/db');
// const logActivity = require('../utils/logActivity');
// const { assignAgentForState } = require('../utils/assignAgent');
// const { TASK_NAMES } = require('../utils/taskFlow');
// const { closeDealWon, closeDealLost, reopenDeal } = require('../utils/dealLifecycle');
// const { getNextDayDateString, getRandomAvailableTimeSlot } = require('../utils/scheduling');

// // Mirrors the enum() definitions on the `properties` table exactly, so a bad value is
// // caught here with a clear message instead of surfacing as a raw MySQL error.
// const STATES = ['Texas', 'Florida'];
// const PROPERTY_TYPES = ['House', 'Apartment', 'Office', 'Shop', 'Hotel', 'Warehouse'];
// const PROPERTY_CONDITIONS = ['Excellent', 'Good', 'Needs Repairs', 'Bad'];
// const PROPERTY_STATUSES = ['On Process', 'Complete', 'Cancelled'];

// // Sequential, field-by-field validation — same style as sellerController.validateSellerFields.
// // Checks run in the same order the fields appear on the form (after Seller, which is
// // checked separately since it needs a DB lookup — see createProperty). Returns the first
// // error message found, or null if everything is valid. `status` is optional since it's
// // only ever supplied on update.
// function validatePropertyFields({
//   property_address, state, county, room, bathrooms,
//   market_value, property_type, property_condition, status
// }) {
//   if (!property_address || !property_address.trim()) return 'Input the property address.';
//   if (property_address.trim().length > 255) return 'Property address must be 255 characters or fewer.';

//   if (!state) return 'Select a state.';
//   if (!STATES.includes(state)) return `State must be one of: ${STATES.join(', ')}.`;

//   if (!county || !county.trim()) return 'Input the county.';
//   if (county.trim().length > 100) return 'County must be 100 characters or fewer.';

//   if (room === undefined || room === null || room === '') return 'Input the number of rooms.';
//   const roomNum = Number(room);
//   if (Number.isNaN(roomNum)) return 'Rooms must be a number.';
//   if (roomNum < 0) return 'Rooms cannot be negative.';
//   if (roomNum > 100) return 'Rooms seems too high (max 100).';

//   if (bathrooms === undefined || bathrooms === null || bathrooms === '') return 'Input the number of bathrooms.';
//   const bathroomsNum = Number(bathrooms);
//   if (Number.isNaN(bathroomsNum)) return 'Bathrooms must be a number.';
//   if (bathroomsNum < 0) return 'Bathrooms cannot be negative.';
//   if (bathroomsNum > 100) return 'Bathrooms seems too high (max 100).';

//   if (market_value === undefined || market_value === null || market_value === '') return 'Input the market value.';
//   if (market_value !== undefined && market_value !== null && market_value !== '') {
//     const marketValueNum = Number(market_value);
//     if (Number.isNaN(marketValueNum)) return 'Market value must be a number.';
//     if (marketValueNum < 0) return 'Market value cannot be negative.';
//     if (marketValueNum > 999999999.99) return 'Market value seems too high (max 999,999,999.99).';
//   }

//   if (!property_type) return 'Select a property type.';
//   if (!PROPERTY_TYPES.includes(property_type)) return `Property type must be one of: ${PROPERTY_TYPES.join(', ')}.`;

//   if (!property_condition) return 'Select a property condition.';
//   if (!PROPERTY_CONDITIONS.includes(property_condition)) {
//     return `Property condition must be one of: ${PROPERTY_CONDITIONS.join(', ')}.`;
//   }

//   if (status !== undefined && status !== null && !PROPERTY_STATUSES.includes(status)) {
//     return `Status must be one of: ${PROPERTY_STATUSES.join(', ')}.`;
//   }

//   return null;
// }

// // GET /api/properties  (joined with seller name, employee/agent name & team, pipeline stage)
// exports.getAllProperties = async (req, res) => {
//   try {
//     const [rows] = await pool.query(`
//       SELECT
//         p.*,
//         s.name AS seller_name,
//         e.name AS agent_name,
//         e.team AS team,
//         sp.stage AS stage
//       FROM properties p
//       JOIN sellers s ON s.id = p.seller_id
//       JOIN employees e ON e.id = p.employee_id
//       LEFT JOIN sales_pipeline sp ON sp.property_id = p.id
//       ORDER BY p.id DESC
//     `);
//     res.json(rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to load properties.' });
//   }
// };

// // GET /api/properties/sellers-without-property  (for the "Seller" dropdown on Add Property)
// exports.getSellersForDropdown = async (req, res) => {
//   try {
//     const [rows] = await pool.query(
//       "SELECT id, name FROM sellers WHERE status = 'Active' ORDER BY name ASC"
//     );
//     res.json(rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to load sellers.' });
//   }
// };

// // POST /api/properties  (Add Property)
// exports.createProperty = async (req, res) => {
//   const conn = await pool.getConnection();
//   try {
//     const {
//       seller_id, property_address, state, county,
//       room, bathrooms, market_value, property_type, property_condition
//     } = req.body;

//     // 1. Seller is checked FIRST, since it's the first field on the form and every other
//     // field depends on a valid seller existing.
//     if (!seller_id) {
//       conn.release();
//       return res.status(400).json({ message: 'Select a seller.' });
//     }
//     const [sellerCheckRows] = await conn.query('SELECT id FROM sellers WHERE id = ?', [seller_id]);
//     if (sellerCheckRows.length === 0) {
//       conn.release();
//       return res.status(400).json({ message: 'Selected seller does not exist.' });
//     }

//     // 2. Then everything else, in form order.
//     const validationError = validatePropertyFields({
//       property_address, state, county, room, bathrooms, market_value, property_type, property_condition
//     });
//     if (validationError) {
//       conn.release();
//       return res.status(400).json({ message: validationError });
//     }

//     await conn.beginTransaction();

//     // 1. Auto-assign team/agent based on state
//     const agent = await assignAgentForState(state);

//     // 2. Insert property (status defaults to 'On Process')
//     const [result] = await conn.query(
//       `INSERT INTO properties
//        (seller_id, employee_id, property_address, state, county, room, bathrooms, market_value, property_type, property_condition)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [seller_id, agent.id, property_address, state, county, room || 0, bathrooms || 0, market_value || 0, property_type, property_condition]
//     );
//     const propertyId = result.insertId;

//     // 3. Attach this property to the pipeline. Every seller already has a pipeline entry
//     // created at "New Lead" the moment they registered (see sellerController.createSeller).
//     // If this is their FIRST property, reuse that existing entry (attach property_id to
//     // it). If they already have other properties (each with their own pipeline entry),
//     // this is an additional property — give it a fresh pipeline entry at "New Lead".
//     const [unattachedPipelineRows] = await conn.query(
//       'SELECT id FROM sales_pipeline WHERE seller_id = ? AND property_id IS NULL LIMIT 1',
//       [seller_id]
//     );
//     if (unattachedPipelineRows.length > 0) {
//       await conn.query(
//         "UPDATE sales_pipeline SET property_id = ?, stage = 'New Lead' WHERE id = ?",
//         [propertyId, unattachedPipelineRows[0].id]
//       );
//     } else {
//       await conn.query(
//         "INSERT INTO sales_pipeline (seller_id, property_id, stage) VALUES (?, ?, 'New Lead')",
//         [seller_id, propertyId]
//       );
//     }

//     // 4. Complete the earlier "Get Property Info" task for this seller, if still open
//     await conn.query(
//       `UPDATE tasks SET status = 'Done'
//        WHERE seller_id = ? AND task = ? AND property_id IS NULL AND status = 'Not Done'`,
//       [seller_id, TASK_NAMES.GET_PROPERTY_INFO]
//     );

//     // 5. Auto-create the next task: "Review Property Info", assigned to the property's agent
//     const dueDate = getNextDayDateString();
//     const dueTime = await getRandomAvailableTimeSlot(conn, agent.id, dueDate);
//     await conn.query(
//       `INSERT INTO tasks (task, seller_id, property_id, task_date, task_time, assigned_to, status)
//        VALUES (?, ?, ?, ?, ?, ?, 'Not Done')`,
//       [TASK_NAMES.REVIEW_PROPERTY_INFO, seller_id, propertyId, dueDate, dueTime, agent.id]
//     );

//     await conn.commit();
//     conn.release();

//     await logActivity(
//       req.user.id,
//       `Property "${property_address}" was recorded and routed to ${agent.team} (${agent.name}).`
//     );

//     const [rows] = await pool.query(
//       `SELECT p.*, s.name AS seller_name, e.name AS agent_name, e.team AS team, sp.stage AS stage
//        FROM properties p
//        JOIN sellers s ON s.id = p.seller_id
//        JOIN employees e ON e.id = p.employee_id
//        LEFT JOIN sales_pipeline sp ON sp.property_id = p.id
//        WHERE p.id = ?`,
//       [propertyId]
//     );
//     res.status(201).json(rows[0]);
//   } catch (err) {
//     await conn.rollback();
//     conn.release();
//     console.error(err);
//     res.status(500).json({ message: err.sqlMessage || err.message || 'Failed to create property.' });
//   }
// };

// // PUT /api/properties/:id  (Edit Property — re-routes team/agent if state changes, and drives
// // the deal-lifecycle automation described below when `status` changes)
// //
// // Status lifecycle automation:
// //   -> 'Complete'    : deal is WON.  Delete ALL tasks tied to this property, set pipeline
// //                      stage to 'Closed - Won'.
// //   -> 'Cancelled'   : deal is LOST. Delete ALL tasks tied to this property, set pipeline
// //                      stage to 'Closed - Lost'.
// //   -> 'On Process'  : deal is REOPENED (only meaningful coming from Complete/Cancelled).
// //                      Delete any leftover tasks, reset pipeline stage to 'New Lead', and
// //                      recreate a fresh "Review Property Info" task so the deal starts over
// //                      exactly where it would after the property was first recorded.
// // The seller-level "Get Property Info" task is never touched here, since it isn't tied to
// // this property_id at all (it's created with property_id = NULL).
// exports.updateProperty = async (req, res) => {
//   const conn = await pool.getConnection();
//   try {
//     const { id } = req.params;
//     const {
//       property_address, state, county, room, bathrooms,
//       market_value, property_type, property_condition, status
//     } = req.body;

//     const [existingRows] = await conn.query('SELECT * FROM properties WHERE id = ?', [id]);
//     if (existingRows.length === 0) {
//       conn.release();
//       return res.status(404).json({ message: 'Property not found.' });
//     }
//     const existing = existingRows[0];

//     const finalAddress = property_address ?? existing.property_address;
//     const finalCounty = county ?? existing.county;
//     const finalRoom = room ?? existing.room;
//     const finalBathrooms = bathrooms ?? existing.bathrooms;
//     const finalMarketValue = market_value ?? existing.market_value;
//     const finalStatus = status ?? existing.status;
//     const finalState = state ?? existing.state;
//     const finalPropertyType = property_type ?? existing.property_type;
//     const finalPropertyCondition = property_condition ?? existing.property_condition;

//     const validationError = validatePropertyFields({
//       property_address: finalAddress,
//       state: finalState,
//       county: finalCounty,
//       room: finalRoom,
//       bathrooms: finalBathrooms,
//       market_value: finalMarketValue,
//       property_type: finalPropertyType,
//       property_condition: finalPropertyCondition,
//       status: finalStatus
//     });
//     if (validationError) {
//       conn.release();
//       return res.status(400).json({ message: validationError });
//     }

//     let employeeId = existing.employee_id;
//     let reassignedNote = '';
//     if (state && state !== existing.state) {
//       const agent = await assignAgentForState(state);
//       employeeId = agent.id;
//       reassignedNote = ` Re-routed to ${agent.team} (${agent.name}) due to state change.`;
//     }

//     await conn.beginTransaction();

//     await conn.query(
//       `UPDATE properties SET
//         property_address = ?, state = ?, county = ?, room = ?, bathrooms = ?,
//         market_value = ?, property_type = ?, property_condition = ?, status = ?, employee_id = ?
//        WHERE id = ?`,
//       [
//         finalAddress,
//         state ?? existing.state,
//         finalCounty,
//         finalRoom,
//         finalBathrooms,
//         finalMarketValue,
//         property_type ?? existing.property_type,
//         property_condition ?? existing.property_condition,
//         finalStatus,
//         employeeId,
//         id
//       ]
//     );

//     let lifecycleNote = '';
//     const statusChanged = finalStatus !== existing.status;

//     if (statusChanged && finalStatus === 'Complete') {
//       lifecycleNote = await closeDealWon(conn, { sellerId: existing.seller_id, propertyId: id });
//     } else if (statusChanged && finalStatus === 'Cancelled') {
//       lifecycleNote = await closeDealLost(conn, { sellerId: existing.seller_id, propertyId: id });
//     } else if (statusChanged && finalStatus === 'On Process') {
//       lifecycleNote = await reopenDeal(conn, { sellerId: existing.seller_id, propertyId: id, employeeId });
//     }

//     await conn.commit();
//     conn.release();

//     await logActivity(req.user.id, `Updated property "${existing.property_address}".${reassignedNote}${lifecycleNote}`);

//     const [rows] = await pool.query(
//       `SELECT p.*, s.name AS seller_name, e.name AS agent_name, e.team AS team, sp.stage AS stage
//        FROM properties p
//        JOIN sellers s ON s.id = p.seller_id
//        JOIN employees e ON e.id = p.employee_id
//        LEFT JOIN sales_pipeline sp ON sp.property_id = p.id
//        WHERE p.id = ?`,
//       [id]
//     );
//     res.json(rows[0]);
//   } catch (err) {
//     await conn.rollback();
//     conn.release();
//     console.error(err);
//     res.status(500).json({ message: err.sqlMessage || err.message || 'Failed to update property.' });
//   }
// };


























// const pool = require('../config/db');
// const logActivity = require('../utils/logActivity');
// const { assignAgentForState } = require('../utils/assignAgent');
// const { TASK_NAMES } = require('../utils/taskFlow');
// const { closeDealWon, closeDealLost, reopenDeal } = require('../utils/dealLifecycle');

// // Mirrors the enum() definitions on the `properties` table exactly, so a bad value is
// // caught here with a clear message instead of surfacing as a raw MySQL error.
// const STATES = ['Texas', 'Florida'];
// const PROPERTY_TYPES = ['House', 'Apartment', 'Office', 'Shop', 'Hotel', 'Warehouse'];
// const PROPERTY_CONDITIONS = ['Excellent', 'Good', 'Needs Repairs', 'Bad'];
// const PROPERTY_STATUSES = ['On Process', 'Complete', 'Cancelled'];

// // Sequential, field-by-field validation — same style as sellerController.validateSellerFields.
// // Checks run in the same order the fields appear on the form (after Seller, which is
// // checked separately since it needs a DB lookup — see createProperty). Returns the first
// // error message found, or null if everything is valid. `status` is optional since it's
// // only ever supplied on update.
// function validatePropertyFields({
//   property_address, state, county, room, bathrooms,
//   market_value, property_type, property_condition, status
// }) {
//   if (!property_address || !property_address.trim()) return 'Input the property address.';
//   if (property_address.trim().length > 255) return 'Property address must be 255 characters or fewer.';

//   if (!state) return 'Select a state.';
//   if (!STATES.includes(state)) return `State must be one of: ${STATES.join(', ')}.`;

//   if (!county || !county.trim()) return 'Input the county.';
//   if (county.trim().length > 100) return 'County must be 100 characters or fewer.';

//   if (room === undefined || room === null || room === '') return 'Input the number of rooms.';
//   if (room !== undefined && room !== null && room !== '') {
//     const roomNum = Number(room);
//     if (Number.isNaN(roomNum)) return 'Rooms must be a number.';
//     if (roomNum < 0) return 'Rooms cannot be negative.';
//     if (roomNum > 100) return 'Rooms seems too high (max 100).';
//   }

//   if (bathrooms === undefined || bathrooms === null || bathrooms === '') return 'Input the number of bathrooms.';
//   if (bathrooms !== undefined && bathrooms !== null && bathrooms !== '') {
//     const bathroomsNum = Number(bathrooms);
//     if (Number.isNaN(bathroomsNum)) return 'Bathrooms must be a number.';
//     if (bathroomsNum < 0) return 'Bathrooms cannot be negative.';
//     if (bathroomsNum > 100) return 'Bathrooms seems too high (max 100).';
//   }

//  if (market_value === undefined || market_value === null || market_value === '') return 'Input the market value.';
//   if (market_value !== undefined && market_value !== null && market_value !== '') {
//     const marketValueNum = Number(market_value);
//     if (Number.isNaN(marketValueNum)) return 'Market value must be a number.';
//     if (marketValueNum <= 0) return 'Market value cannot be negative or 0.';
//     if (marketValueNum > 999999999.99) return 'Market value seems too high (max 999,999,999.99).';
//   }

//   if (!property_type) return 'Select a property type.';
//   if (!PROPERTY_TYPES.includes(property_type)) return `Property type must be one of: ${PROPERTY_TYPES.join(', ')}.`;

//   if (!property_condition) return 'Select a property condition.';
//   if (!PROPERTY_CONDITIONS.includes(property_condition)) {
//     return `Property condition must be one of: ${PROPERTY_CONDITIONS.join(', ')}.`;
//   }

//   if (status !== undefined && status !== null && !PROPERTY_STATUSES.includes(status)) {
//     return `Status must be one of: ${PROPERTY_STATUSES.join(', ')}.`;
//   }

//   return null;
// }

// // GET /api/properties  (joined with seller name, employee/agent name & team, pipeline stage)
// exports.getAllProperties = async (req, res) => {
//   try {
//     const [rows] = await pool.query(`
//       SELECT
//         p.*,
//         s.name AS seller_name,
//         e.name AS agent_name,
//         e.team AS team,
//         sp.stage AS stage
//       FROM properties p
//       JOIN sellers s ON s.id = p.seller_id
//       JOIN employees e ON e.id = p.employee_id
//       LEFT JOIN sales_pipeline sp ON sp.property_id = p.id
//       ORDER BY p.id DESC
//     `);
//     res.json(rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to load properties.' });
//   }
// };

// // GET /api/properties/sellers-without-property  (for the "Seller" dropdown on Add Property)
// exports.getSellersForDropdown = async (req, res) => {
//   try {
//     const [rows] = await pool.query(
//       "SELECT id, name FROM sellers WHERE status = 'Active' ORDER BY name ASC"
//     );
//     res.json(rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to load sellers.' });
//   }
// };

// // POST /api/properties  (Add Property)
// exports.createProperty = async (req, res) => {
//   const conn = await pool.getConnection();
//   try {
//     const {
//       seller_id, property_address, state, county,
//       room, bathrooms, market_value, property_type, property_condition
//     } = req.body;

//     // 1. Seller is checked FIRST, since it's the first field on the form and every other
//     // field depends on a valid seller existing.
//     if (!seller_id) {
//       conn.release();
//       return res.status(400).json({ message: 'Select a seller.' });
//     }
//     const [sellerCheckRows] = await conn.query('SELECT id FROM sellers WHERE id = ?', [seller_id]);
//     if (sellerCheckRows.length === 0) {
//       conn.release();
//       return res.status(400).json({ message: 'Selected seller does not exist.' });
//     }

//     // 2. Then everything else, in form order.
//     const validationError = validatePropertyFields({
//       property_address, state, county, room, bathrooms, market_value, property_type, property_condition
//     });
//     if (validationError) {
//       conn.release();
//       return res.status(400).json({ message: validationError });
//     }

//     await conn.beginTransaction();

//     // 1. Auto-assign team/agent based on state
//     const agent = await assignAgentForState(state);

//     // 2. Insert property (status defaults to 'On Process')
//     const [result] = await conn.query(
//       `INSERT INTO properties
//        (seller_id, employee_id, property_address, state, county, room, bathrooms, market_value, property_type, property_condition)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [seller_id, agent.id, property_address, state, county, room || 0, bathrooms || 0, market_value || 0, property_type, property_condition]
//     );
//     const propertyId = result.insertId;

//     // 3. Attach this property to the pipeline. Every seller already has a pipeline entry
//     // created at "New Lead" the moment they registered (see sellerController.createSeller).
//     // If this is their FIRST property, reuse that existing entry (attach property_id to
//     // it). If they already have other properties (each with their own pipeline entry),
//     // this is an additional property — give it a fresh pipeline entry at "New Lead".
//     const [unattachedPipelineRows] = await conn.query(
//       'SELECT id FROM sales_pipeline WHERE seller_id = ? AND property_id IS NULL LIMIT 1',
//       [seller_id]
//     );
//     if (unattachedPipelineRows.length > 0) {
//       await conn.query(
//         "UPDATE sales_pipeline SET property_id = ?, stage = 'New Lead' WHERE id = ?",
//         [propertyId, unattachedPipelineRows[0].id]
//       );
//     } else {
//       await conn.query(
//         "INSERT INTO sales_pipeline (seller_id, property_id, stage) VALUES (?, ?, 'New Lead')",
//         [seller_id, propertyId]
//       );
//     }

//     // 4. Complete the earlier "Get Property Info" task for this seller, if still open
//     await conn.query(
//       `UPDATE tasks SET status = 'Done'
//        WHERE seller_id = ? AND task = ? AND property_id IS NULL AND status = 'Not Done'`,
//       [seller_id, TASK_NAMES.GET_PROPERTY_INFO]
//     );

//     // 5. Auto-create the next task: "Review Property Info", assigned to the property's agent
//     const today = new Date().toISOString().slice(0, 10);
//     await conn.query(
//       `INSERT INTO tasks (task, seller_id, property_id, task_date, task_time, assigned_to, status)
//        VALUES (?, ?, ?, ?, '09:00:00', ?, 'Not Done')`,
//       [TASK_NAMES.REVIEW_PROPERTY_INFO, seller_id, propertyId, today, agent.id]
//     );

//     await conn.commit();
//     conn.release();

//     await logActivity(
//       req.user.id,
//       `Property "${property_address}" was recorded and routed to ${agent.team} (${agent.name}).`
//     );

//     const [rows] = await pool.query(
//       `SELECT p.*, s.name AS seller_name, e.name AS agent_name, e.team AS team, sp.stage AS stage
//        FROM properties p
//        JOIN sellers s ON s.id = p.seller_id
//        JOIN employees e ON e.id = p.employee_id
//        LEFT JOIN sales_pipeline sp ON sp.property_id = p.id
//        WHERE p.id = ?`,
//       [propertyId]
//     );
//     res.status(201).json(rows[0]);
//   } catch (err) {
//     await conn.rollback();
//     conn.release();
//     console.error(err);
//     res.status(500).json({ message: err.sqlMessage || err.message || 'Failed to create property.' });
//   }
// };

// // PUT /api/properties/:id  (Edit Property — re-routes team/agent if state changes, and drives
// // the deal-lifecycle automation described below when `status` changes)
// //
// // Status lifecycle automation:
// //   -> 'Complete'    : deal is WON.  Delete ALL tasks tied to this property, set pipeline
// //                      stage to 'Closed - Won'.
// //   -> 'Cancelled'   : deal is LOST. Delete ALL tasks tied to this property, set pipeline
// //                      stage to 'Closed - Lost'.
// //   -> 'On Process'  : deal is REOPENED (only meaningful coming from Complete/Cancelled).
// //                      Delete any leftover tasks, reset pipeline stage to 'New Lead', and
// //                      recreate a fresh "Review Property Info" task so the deal starts over
// //                      exactly where it would after the property was first recorded.
// // The seller-level "Get Property Info" task is never touched here, since it isn't tied to
// // this property_id at all (it's created with property_id = NULL).
// exports.updateProperty = async (req, res) => {
//   const conn = await pool.getConnection();
//   try {
//     const { id } = req.params;
//     const {
//       property_address, state, county, room, bathrooms,
//       market_value, property_type, property_condition, status
//     } = req.body;

//     const [existingRows] = await conn.query('SELECT * FROM properties WHERE id = ?', [id]);
//     if (existingRows.length === 0) {
//       conn.release();
//       return res.status(404).json({ message: 'Property not found.' });
//     }
//     const existing = existingRows[0];

//     const finalAddress = property_address ?? existing.property_address;
//     const finalCounty = county ?? existing.county;
//     const finalRoom = room ?? existing.room;
//     const finalBathrooms = bathrooms ?? existing.bathrooms;
//     const finalMarketValue = market_value ?? existing.market_value;
//     const finalStatus = status ?? existing.status;
//     const finalState = state ?? existing.state;
//     const finalPropertyType = property_type ?? existing.property_type;
//     const finalPropertyCondition = property_condition ?? existing.property_condition;

//     const validationError = validatePropertyFields({
//       property_address: finalAddress,
//       state: finalState,
//       county: finalCounty,
//       room: finalRoom,
//       bathrooms: finalBathrooms,
//       market_value: finalMarketValue,
//       property_type: finalPropertyType,
//       property_condition: finalPropertyCondition,
//       status: finalStatus
//     });
//     if (validationError) {
//       conn.release();
//       return res.status(400).json({ message: validationError });
//     }

//     let employeeId = existing.employee_id;
//     let reassignedNote = '';
//     if (state && state !== existing.state) {
//       const agent = await assignAgentForState(state);
//       employeeId = agent.id;
//       reassignedNote = ` Re-routed to ${agent.team} (${agent.name}) due to state change.`;
//     }

//     await conn.beginTransaction();

//     await conn.query(
//       `UPDATE properties SET
//         property_address = ?, state = ?, county = ?, room = ?, bathrooms = ?,
//         market_value = ?, property_type = ?, property_condition = ?, status = ?, employee_id = ?
//        WHERE id = ?`,
//       [
//         finalAddress,
//         state ?? existing.state,
//         finalCounty,
//         finalRoom,
//         finalBathrooms,
//         finalMarketValue,
//         property_type ?? existing.property_type,
//         property_condition ?? existing.property_condition,
//         finalStatus,
//         employeeId,
//         id
//       ]
//     );

//     let lifecycleNote = '';
//     const statusChanged = finalStatus !== existing.status;

//     if (statusChanged && finalStatus === 'Complete') {
//       lifecycleNote = await closeDealWon(conn, { sellerId: existing.seller_id, propertyId: id });
//     } else if (statusChanged && finalStatus === 'Cancelled') {
//       lifecycleNote = await closeDealLost(conn, { sellerId: existing.seller_id, propertyId: id });
//     } else if (statusChanged && finalStatus === 'On Process') {
//       lifecycleNote = await reopenDeal(conn, { sellerId: existing.seller_id, propertyId: id, employeeId });
//     }

//     await conn.commit();
//     conn.release();

//     await logActivity(req.user.id, `Updated property "${existing.property_address}".${reassignedNote}${lifecycleNote}`);

//     const [rows] = await pool.query(
//       `SELECT p.*, s.name AS seller_name, e.name AS agent_name, e.team AS team, sp.stage AS stage
//        FROM properties p
//        JOIN sellers s ON s.id = p.seller_id
//        JOIN employees e ON e.id = p.employee_id
//        LEFT JOIN sales_pipeline sp ON sp.property_id = p.id
//        WHERE p.id = ?`,
//       [id]
//     );
//     res.json(rows[0]);
//   } catch (err) {
//     await conn.rollback();
//     conn.release();
//     console.error(err);
//     res.status(500).json({ message: err.sqlMessage || err.message || 'Failed to update property.' });
//   }
// };











































// const pool = require('../config/db');
// const logActivity = require('../utils/logActivity');
// const { assignAgentForState } = require('../utils/assignAgent');
// const { TASK_NAMES } = require('../utils/taskFlow');
// const { closeDealWon, closeDealLost, reopenDeal } = require('../utils/dealLifecycle');
// const {
//   validateRequiredText, validateMaxLength, validateEnum,
//   validateNumberInRange, firstError
// } = require('../utils/validators');

// // Mirrors the enum() definitions on the `properties` table exactly, so a bad value is
// // caught here with a clear message instead of surfacing as a raw MySQL error.
// const STATES = ['Texas', 'Florida'];
// const PROPERTY_TYPES = ['House', 'Apartment', 'Office', 'Shop', 'Hotel', 'Warehouse'];
// const PROPERTY_CONDITIONS = ['Excellent', 'Good', 'Needs Repairs', 'Bad'];
// const PROPERTY_STATUSES = ['On Process', 'Complete', 'Cancelled'];

// // GET /api/properties  (joined with seller name, employee/agent name & team, pipeline stage)
// exports.getAllProperties = async (req, res) => {
//   try {
//     const [rows] = await pool.query(`
//       SELECT
//         p.*,
//         s.name AS seller_name,
//         e.name AS agent_name,
//         e.team AS team,
//         sp.stage AS stage
//       FROM properties p
//       JOIN sellers s ON s.id = p.seller_id
//       JOIN employees e ON e.id = p.employee_id
//       LEFT JOIN sales_pipeline sp ON sp.property_id = p.id
//       ORDER BY p.id DESC
//     `);
//     res.json(rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to load properties.' });
//   }
// };

// // GET /api/properties/sellers-without-property  (for the "Seller" dropdown on Add Property)
// exports.getSellersForDropdown = async (req, res) => {
//   try {
//     const [rows] = await pool.query(
//       "SELECT id, name FROM sellers WHERE status = 'Active' ORDER BY name ASC"
//     );
//     res.json(rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to load sellers.' });
//   }
// };

// // POST /api/properties  (Add Property)
// exports.createProperty = async (req, res) => {
//   const conn = await pool.getConnection();
//   try {
//     const {
//       seller_id, property_address, state, county,
//       room, bathrooms, market_value, property_type, property_condition
//     } = req.body;

//     const [sellerCheckRows] = await conn.query('SELECT id FROM sellers WHERE id = ?', [seller_id]);
//     if (sellerCheckRows.length === 0) {
//       conn.release();
//       return res.status(400).json({ message: 'Selected seller does not exist.' });
//     }

//     const validationError = firstError([
//       [validateRequiredText, property_address, 'Property address'],
//       [validateMaxLength, property_address, 255, 'Property address'],
//       [validateEnum, state, STATES, 'State'],
//       [validateRequiredText, county, 'County'],
//       [validateMaxLength, county, 100, 'County'],
//       [validateNumberInRange, room, 'Rooms', 100],
//       [validateNumberInRange, bathrooms, 'Bathrooms', 100],
//       [validateNumberInRange, market_value, 'Market value', 999999999.99],
//       [validateEnum, property_type, PROPERTY_TYPES, 'Property type'],
//       [validateEnum, property_condition, PROPERTY_CONDITIONS, 'Property condition']
//     ]);

//     if (validationError) {
//       conn.release();
//       return res.status(400).json({ message: validationError });
//     }


//     await conn.beginTransaction();

//     // 1. Auto-assign team/agent based on state
//     const agent = await assignAgentForState(state);

//     // 2. Insert property (status defaults to 'On Process')
//     const [result] = await conn.query(
//       `INSERT INTO properties
//        (seller_id, employee_id, property_address, state, county, room, bathrooms, market_value, property_type, property_condition)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [seller_id, agent.id, property_address, state, county, room || 0, bathrooms || 0, market_value || 0, property_type, property_condition]
//     );
//     const propertyId = result.insertId;

//     // 3. Seller becomes "Seller" now that they have a property on record
//     await conn.query("UPDATE sellers SET seller_type = 'Seller' WHERE id = ?", [seller_id]);

//     // 4. Attach this property to the pipeline. Every seller already has a pipeline entry
//     // created at "New Lead" the moment they registered (see sellerController.createSeller).
//     // If this is their FIRST property, reuse that existing entry (attach property_id to
//     // it). If they already have other properties (each with their own pipeline entry),
//     // this is an additional property — give it a fresh pipeline entry at "New Lead".
//     const [unattachedPipelineRows] = await conn.query(
//       'SELECT id FROM sales_pipeline WHERE seller_id = ? AND property_id IS NULL LIMIT 1',
//       [seller_id]
//     );
//     if (unattachedPipelineRows.length > 0) {
//       await conn.query(
//         "UPDATE sales_pipeline SET property_id = ?, stage = 'New Lead' WHERE id = ?",
//         [propertyId, unattachedPipelineRows[0].id]
//       );
//     } else {
//       await conn.query(
//         "INSERT INTO sales_pipeline (seller_id, property_id, stage) VALUES (?, ?, 'New Lead')",
//         [seller_id, propertyId]
//       );
//     }

//     // 5. Complete the earlier "Get Property Info" task for this seller, if still open
//     await conn.query(
//       `UPDATE tasks SET status = 'Done'
//        WHERE seller_id = ? AND task = ? AND property_id IS NULL AND status = 'Not Done'`,
//       [seller_id, TASK_NAMES.GET_PROPERTY_INFO]
//     );

//     // 6. Auto-create the next task: "Review Property Info", assigned to the property's agent
//     const today = new Date().toISOString().slice(0, 10);
//     await conn.query(
//       `INSERT INTO tasks (task, seller_id, property_id, task_date, task_time, assigned_to, status)
//        VALUES (?, ?, ?, ?, '09:00:00', ?, 'Not Done')`,
//       [TASK_NAMES.REVIEW_PROPERTY_INFO, seller_id, propertyId, today, agent.id]
//     );

//     await conn.commit();
//     conn.release();

//     await logActivity(
//       req.user.id,
//       `Property "${property_address}" was recorded and routed to ${agent.team} (${agent.name}).`
//     );

//     const [rows] = await pool.query(
//       `SELECT p.*, s.name AS seller_name, e.name AS agent_name, e.team AS team, sp.stage AS stage
//        FROM properties p
//        JOIN sellers s ON s.id = p.seller_id
//        JOIN employees e ON e.id = p.employee_id
//        LEFT JOIN sales_pipeline sp ON sp.property_id = p.id
//        WHERE p.id = ?`,
//       [propertyId]
//     );
//     res.status(201).json(rows[0]);
//   } catch (err) {
//     await conn.rollback();
//     conn.release();
//     console.error(err);
//     res.status(500).json({ message: err.message || 'Failed to create property.' });
//   }
// };

// // PUT /api/properties/:id  (Edit Property — re-routes team/agent if state changes, and drives
// // the deal-lifecycle automation described below when `status` changes)
// //
// // Status lifecycle automation:
// //   -> 'Complete'    : deal is WON.  Delete ALL tasks tied to this property, set pipeline
// //                      stage to 'Closed - Won'.
// //   -> 'Cancelled'   : deal is LOST. Delete ALL tasks tied to this property, set pipeline
// //                      stage to 'Closed - Lost'.
// //   -> 'On Process'  : deal is REOPENED (only meaningful coming from Complete/Cancelled).
// //                      Delete any leftover tasks, reset pipeline stage to 'New Lead', and
// //                      recreate a fresh "Review Property Info" task so the deal starts over
// //                      exactly where it would after the property was first recorded.
// // The seller-level "Get Property Info" task is never touched here, since it isn't tied to
// // this property_id at all (it's created with property_id = NULL).
// exports.updateProperty = async (req, res) => {
//   const conn = await pool.getConnection();
//   try {
//     const { id } = req.params;
//     const {
//       property_address, state, county, room, bathrooms,
//       market_value, property_type, property_condition, status
//     } = req.body;

//     const [existingRows] = await conn.query('SELECT * FROM properties WHERE id = ?', [id]);
//     if (existingRows.length === 0) {
//       conn.release();
//       return res.status(404).json({ message: 'Property not found.' });
//     }
//     const existing = existingRows[0];

//     const finalAddress = property_address ?? existing.property_address;
//     const finalCounty = county ?? existing.county;
//     const finalRoom = room ?? existing.room;
//     const finalBathrooms = bathrooms ?? existing.bathrooms;
//     const finalMarketValue = market_value ?? existing.market_value;
//     const finalStatus = status ?? existing.status;
//     const finalState = state ?? existing.state;
//     const finalPropertyType = property_type ?? existing.property_type;
//     const finalPropertyCondition = property_condition ?? existing.property_condition;

//     const validationError = firstError([
//       [validateRequiredText, finalAddress, 'Property address'],
//       [validateMaxLength, finalAddress, 255, 'Property address'],
//       [validateEnum, finalState, STATES, 'State'],
//       [validateRequiredText, finalCounty, 'County'],
//       [validateMaxLength, finalCounty, 100, 'County'],
//       [validateNumberInRange, finalRoom, 'Rooms', 100],
//       [validateNumberInRange, finalBathrooms, 'Bathrooms', 100],
//       [validateNumberInRange, finalMarketValue, 'Market value', 999999999.99],
//       [validateEnum, finalPropertyType, PROPERTY_TYPES, 'Property type'],
//       [validateEnum, finalPropertyCondition, PROPERTY_CONDITIONS, 'Property condition'],
//       [validateEnum, finalStatus, PROPERTY_STATUSES, 'Status']
//     ]);
//     if (validationError) {
//       conn.release();
//       return res.status(400).json({ message: validationError });
//     }

//     let employeeId = existing.employee_id;
//     let reassignedNote = '';
//     if (state && state !== existing.state) {
//       const agent = await assignAgentForState(state);
//       employeeId = agent.id;
//       reassignedNote = ` Re-routed to ${agent.team} (${agent.name}) due to state change.`;
//     }

//     await conn.beginTransaction();

//     await conn.query(
//       `UPDATE properties SET
//         property_address = ?, state = ?, county = ?, room = ?, bathrooms = ?,
//         market_value = ?, property_type = ?, property_condition = ?, status = ?, employee_id = ?
//        WHERE id = ?`,
//       [
//         finalAddress,
//         state ?? existing.state,
//         finalCounty,
//         finalRoom,
//         finalBathrooms,
//         finalMarketValue,
//         property_type ?? existing.property_type,
//         property_condition ?? existing.property_condition,
//         finalStatus,
//         employeeId,
//         id
//       ]
//     );

//     let lifecycleNote = '';
//     const statusChanged = finalStatus !== existing.status;

//     if (statusChanged && finalStatus === 'Complete') {
//       lifecycleNote = await closeDealWon(conn, { sellerId: existing.seller_id, propertyId: id });
//     } else if (statusChanged && finalStatus === 'Cancelled') {
//       lifecycleNote = await closeDealLost(conn, { sellerId: existing.seller_id, propertyId: id });
//     } else if (statusChanged && finalStatus === 'On Process') {
//       lifecycleNote = await reopenDeal(conn, { sellerId: existing.seller_id, propertyId: id, employeeId });
//     }

//     await conn.commit();
//     conn.release();

//     await logActivity(req.user.id, `Updated property "${existing.property_address}".${reassignedNote}${lifecycleNote}`);

//     const [rows] = await pool.query(
//       `SELECT p.*, s.name AS seller_name, e.name AS agent_name, e.team AS team, sp.stage AS stage
//        FROM properties p
//        JOIN sellers s ON s.id = p.seller_id
//        JOIN employees e ON e.id = p.employee_id
//        LEFT JOIN sales_pipeline sp ON sp.property_id = p.id
//        WHERE p.id = ?`,
//       [id]
//     );
//     res.json(rows[0]);
//   } catch (err) {
//     await conn.rollback();
//     conn.release();
//     console.error(err);
//     res.status(500).json({ message: err.message || 'Failed to update property.' });
//   }
// };



















// const pool = require('../config/db');
// const logActivity = require('../utils/logActivity');
// const { assignAgentForState } = require('../utils/assignAgent');
// const { TASK_NAMES } = require('../utils/taskFlow');
// const { closeDealWon, closeDealLost, reopenDeal } = require('../utils/dealLifecycle');
// const { validateRequiredText, validateNonNegativeNumber, firstError } = require('../utils/validators');

// // GET /api/properties  (joined with seller name, employee/agent name & team, pipeline stage)
// exports.getAllProperties = async (req, res) => {
//   try {
//     const [rows] = await pool.query(`
//       SELECT
//         p.*,
//         s.name AS seller_name,
//         e.name AS agent_name,
//         e.team AS team,
//         sp.stage AS stage
//       FROM properties p
//       JOIN sellers s ON s.id = p.seller_id
//       JOIN employees e ON e.id = p.employee_id
//       LEFT JOIN sales_pipeline sp ON sp.property_id = p.id
//       ORDER BY p.id DESC
//     `);
//     res.json(rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to load properties.' });
//   }
// };

// // GET /api/properties/sellers-without-property  (for the "Seller" dropdown on Add Property)
// exports.getSellersForDropdown = async (req, res) => {
//   try {
//     const [rows] = await pool.query(
//       "SELECT id, name FROM sellers WHERE status = 'Active' ORDER BY name ASC"
//     );
//     res.json(rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to load sellers.' });
//   }
// };

// // POST /api/properties  (Add Property)
// exports.createProperty = async (req, res) => {
//   const conn = await pool.getConnection();
//   try {
//     const {
//       seller_id, property_address, state, county,
//       room, bathrooms, market_value, property_type, property_condition
//     } = req.body;

//     if (!seller_id || !property_address || !state || !county || !property_type || !property_condition) {
//       conn.release();
//       return res.status(400).json({ message: 'Please fill in all required property fields.' });
//     }

//     const validationError = firstError([
//       [validateRequiredText, property_address, 'Property address'],
//       [validateRequiredText, county, 'County'],
//       [validateNonNegativeNumber, room, 'Rooms'],
//       [validateNonNegativeNumber, bathrooms, 'Bathrooms'],
//       [validateNonNegativeNumber, market_value, 'Market value']
//     ]);
//     if (validationError) {
//       conn.release();
//       return res.status(400).json({ message: validationError });
//     }

//     await conn.beginTransaction();

//     // 1. Auto-assign team/agent based on state
//     const agent = await assignAgentForState(state);

//     // 2. Insert property (status defaults to 'On Process')
//     const [result] = await conn.query(
//       `INSERT INTO properties
//        (seller_id, employee_id, property_address, state, county, room, bathrooms, market_value, property_type, property_condition)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [seller_id, agent.id, property_address, state, county, room || 0, bathrooms || 0, market_value || 0, property_type, property_condition]
//     );
//     const propertyId = result.insertId;

//     // 3. Seller becomes "Seller" now that they have a property on record
//     await conn.query("UPDATE sellers SET seller_type = 'Seller' WHERE id = ?", [seller_id]);

//     // 4. Create pipeline entry at stage "New Lead"
//     await conn.query(
//       "INSERT INTO sales_pipeline (seller_id, property_id, stage) VALUES (?, ?, 'New Lead')",
//       [seller_id, propertyId]
//     );

//     // 5. Complete the earlier "Get Property Info" task for this seller, if still open
//     await conn.query(
//       `UPDATE tasks SET status = 'Done'
//        WHERE seller_id = ? AND task = ? AND property_id IS NULL AND status = 'Not Done'`,
//       [seller_id, TASK_NAMES.GET_PROPERTY_INFO]
//     );

//     // 6. Auto-create the next task: "Review Property Info", assigned to the property's agent
//     const today = new Date().toISOString().slice(0, 10);
//     await conn.query(
//       `INSERT INTO tasks (task, seller_id, property_id, task_date, task_time, assigned_to, status)
//        VALUES (?, ?, ?, ?, '09:00:00', ?, 'Not Done')`,
//       [TASK_NAMES.REVIEW_PROPERTY_INFO, seller_id, propertyId, today, agent.id]
//     );

//     await conn.commit();
//     conn.release();

//     await logActivity(
//       req.user.id,
//       `Property "${property_address}" was recorded and routed to ${agent.team} (${agent.name}).`
//     );

//     const [rows] = await pool.query(
//       `SELECT p.*, s.name AS seller_name, e.name AS agent_name, e.team AS team, sp.stage AS stage
//        FROM properties p
//        JOIN sellers s ON s.id = p.seller_id
//        JOIN employees e ON e.id = p.employee_id
//        LEFT JOIN sales_pipeline sp ON sp.property_id = p.id
//        WHERE p.id = ?`,
//       [propertyId]
//     );
//     res.status(201).json(rows[0]);
//   } catch (err) {
//     await conn.rollback();
//     conn.release();
//     console.error(err);
//     res.status(500).json({ message: err.message || 'Failed to create property.' });
//   }
// };

// // PUT /api/properties/:id  (Edit Property — re-routes team/agent if state changes, and drives
// // the deal-lifecycle automation described below when `status` changes)
// //
// // Status lifecycle automation:
// //   -> 'Complete'    : deal is WON.  Delete ALL tasks tied to this property, set pipeline
// //                      stage to 'Closed - Won'.
// //   -> 'Cancelled'   : deal is LOST. Delete ALL tasks tied to this property, set pipeline
// //                      stage to 'Closed - Lost'.
// //   -> 'On Process'  : deal is REOPENED (only meaningful coming from Complete/Cancelled).
// //                      Delete any leftover tasks, reset pipeline stage to 'New Lead', and
// //                      recreate a fresh "Review Property Info" task so the deal starts over
// //                      exactly where it would after the property was first recorded.
// // This same logic is shared with taskController — marking "Contract Signing" Done fires
// // the exact same closeDealWon() function used here.
// exports.updateProperty = async (req, res) => {
//   const conn = await pool.getConnection();
//   try {
//     const { id } = req.params;
//     const {
//       property_address, state, county, room, bathrooms,
//       market_value, property_type, property_condition, status
//     } = req.body;

//     const [existingRows] = await conn.query('SELECT * FROM properties WHERE id = ?', [id]);
//     if (existingRows.length === 0) {
//       conn.release();
//       return res.status(404).json({ message: 'Property not found.' });
//     }
//     const existing = existingRows[0];

//     const finalAddress = property_address ?? existing.property_address;
//     const finalCounty = county ?? existing.county;
//     const finalRoom = room ?? existing.room;
//     const finalBathrooms = bathrooms ?? existing.bathrooms;
//     const finalMarketValue = market_value ?? existing.market_value;
//     const finalStatus = status ?? existing.status;

//     const validationError = firstError([
//       [validateRequiredText, finalAddress, 'Property address'],
//       [validateRequiredText, finalCounty, 'County'],
//       [validateNonNegativeNumber, finalRoom, 'Rooms'],
//       [validateNonNegativeNumber, finalBathrooms, 'Bathrooms'],
//       [validateNonNegativeNumber, finalMarketValue, 'Market value']
//     ]);
//     if (validationError) {
//       conn.release();
//       return res.status(400).json({ message: validationError });
//     }

//     let employeeId = existing.employee_id;
//     let reassignedNote = '';
//     if (state && state !== existing.state) {
//       const agent = await assignAgentForState(state);
//       employeeId = agent.id;
//       reassignedNote = ` Re-routed to ${agent.team} (${agent.name}) due to state change.`;
//     }

//     await conn.beginTransaction();

//     await conn.query(
//       `UPDATE properties SET
//         property_address = ?, state = ?, county = ?, room = ?, bathrooms = ?,
//         market_value = ?, property_type = ?, property_condition = ?, status = ?, employee_id = ?
//        WHERE id = ?`,
//       [
//         finalAddress,
//         state ?? existing.state,
//         finalCounty,
//         finalRoom,
//         finalBathrooms,
//         finalMarketValue,
//         property_type ?? existing.property_type,
//         property_condition ?? existing.property_condition,
//         finalStatus,
//         employeeId,
//         id
//       ]
//     );

//     let lifecycleNote = '';
//     const statusChanged = finalStatus !== existing.status;

//     if (statusChanged && finalStatus === 'Complete') {
//       lifecycleNote = await closeDealWon(conn, { sellerId: existing.seller_id, propertyId: id });
//     } else if (statusChanged && finalStatus === 'Cancelled') {
//       lifecycleNote = await closeDealLost(conn, { sellerId: existing.seller_id, propertyId: id });
//     } else if (statusChanged && finalStatus === 'On Process') {
//       lifecycleNote = await reopenDeal(conn, { sellerId: existing.seller_id, propertyId: id, employeeId });
//     }

//     await conn.commit();
//     conn.release();

//     await logActivity(req.user.id, `Updated property "${existing.property_address}".${reassignedNote}${lifecycleNote}`);

//     const [rows] = await pool.query(
//       `SELECT p.*, s.name AS seller_name, e.name AS agent_name, e.team AS team, sp.stage AS stage
//        FROM properties p
//        JOIN sellers s ON s.id = p.seller_id
//        JOIN employees e ON e.id = p.employee_id
//        LEFT JOIN sales_pipeline sp ON sp.property_id = p.id
//        WHERE p.id = ?`,
//       [id]
//     );
//     res.json(rows[0]);
//   } catch (err) {
//     await conn.rollback();
//     conn.release();
//     console.error(err);
//     res.status(500).json({ message: err.message || 'Failed to update property.' });
//   }
// };










// const pool = require('../config/db');
// const logActivity = require('../utils/logActivity');
// const { assignAgentForState } = require('../utils/assignAgent');
// const { TASK_NAMES } = require('../utils/taskFlow');
// const { closeDealWon, closeDealLost, reopenDeal } = require('../utils/dealLifecycle');
// const { validateRequiredText, validateNonNegativeNumber, firstError } = require('../utils/validators');

// // GET /api/properties  (joined with seller name, employee/agent name & team, pipeline stage)
// exports.getAllProperties = async (req, res) => {
//   try {
//     const [rows] = await pool.query(`
//       SELECT
//         p.*,
//         s.name AS seller_name,
//         e.name AS agent_name,
//         e.team AS team,
//         sp.stage AS stage
//       FROM properties p
//       JOIN sellers s ON s.id = p.seller_id
//       JOIN employees e ON e.id = p.employee_id
//       LEFT JOIN sales_pipeline sp ON sp.property_id = p.id
//       ORDER BY p.id DESC
//     `);
//     res.json(rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to load properties.' });
//   }
// };

// // GET /api/properties/sellers-without-property  (for the "Seller" dropdown on Add Property)
// exports.getSellersForDropdown = async (req, res) => {
//   try {
//     const [rows] = await pool.query(
//       "SELECT id, name FROM sellers WHERE status = 'Active' ORDER BY name ASC"
//     );
//     res.json(rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to load sellers.' });
//   }
// };

// // POST /api/properties  (Add Property)
// exports.createProperty = async (req, res) => {
//   const conn = await pool.getConnection();
//   try {
//     const {
//       seller_id, property_address, state, county,
//       room, bathrooms, market_value, property_type, property_condition
//     } = req.body;

//     if (!seller_id || !property_address || !state || !county || !property_type || !property_condition) {
//       conn.release();
//       return res.status(400).json({ message: 'Please fill in all required property fields.' });
//     }

//     const validationError = firstError([
//       [validateRequiredText, property_address, 'Property address'],
//       [validateRequiredText, county, 'County'],
//       [validateNonNegativeNumber, room, 'Rooms'],
//       [validateNonNegativeNumber, bathrooms, 'Bathrooms'],
//       [validateNonNegativeNumber, market_value, 'Market value']
//     ]);
//     if (validationError) {
//       conn.release();
//       return res.status(400).json({ message: validationError });
//     }

//     await conn.beginTransaction();

//     // 1. Auto-assign team/agent based on state
//     const agent = await assignAgentForState(state);

//     // 2. Insert property (status defaults to 'On Process')
//     const [result] = await conn.query(
//       `INSERT INTO properties
//        (seller_id, employee_id, property_address, state, county, room, bathrooms, market_value, property_type, property_condition)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [seller_id, agent.id, property_address, state, county, room || 0, bathrooms || 0, market_value || 0, property_type, property_condition]
//     );
//     const propertyId = result.insertId;

//     // 3. Attach this property to the pipeline. Every seller already has a pipeline entry
//     // created at "New Lead" the moment they registered (see sellerController.createSeller).
//     // If this is their FIRST property, reuse that existing entry (attach property_id to
//     // it). If they already have other properties (each with their own pipeline entry),
//     // this is an additional property — give it a fresh pipeline entry at "New Lead".
//     const [unattachedPipelineRows] = await conn.query(
//       'SELECT id FROM sales_pipeline WHERE seller_id = ? AND property_id IS NULL LIMIT 1',
//       [seller_id]
//     );
//     if (unattachedPipelineRows.length > 0) {
//       await conn.query(
//         "UPDATE sales_pipeline SET property_id = ?, stage = 'New Lead' WHERE id = ?",
//         [propertyId, unattachedPipelineRows[0].id]
//       );
//     } else {
//       await conn.query(
//         "INSERT INTO sales_pipeline (seller_id, property_id, stage) VALUES (?, ?, 'New Lead')",
//         [seller_id, propertyId]
//       );
//     }
    
//     // 4. Auto-create the next task: "Review Property Info", assigned to the property's agent
//     const today = new Date().toISOString().slice(0, 10);
//     await conn.query(
//       `INSERT INTO tasks (task, seller_id, property_id, task_date, task_time, assigned_to, status)
//        VALUES (?, ?, ?, ?, '09:00:00', ?, 'Not Done')`,
//       [TASK_NAMES.REVIEW_PROPERTY_INFO, seller_id, propertyId, today, agent.id]
//     );

//     await conn.commit();
//     conn.release();

//     await logActivity(
//       req.user.id,
//       `Property "${property_address}" was recorded and routed to ${agent.team} (${agent.name}).`
//     );

//     const [rows] = await pool.query(
//       `SELECT p.*, s.name AS seller_name, e.name AS agent_name, e.team AS team, sp.stage AS stage
//        FROM properties p
//        JOIN sellers s ON s.id = p.seller_id
//        JOIN employees e ON e.id = p.employee_id
//        LEFT JOIN sales_pipeline sp ON sp.property_id = p.id
//        WHERE p.id = ?`,
//       [propertyId]
//     );
//     res.status(201).json(rows[0]);
//   } catch (err) {
//     await conn.rollback();
//     conn.release();
//     console.error(err);
//     res.status(500).json({ message: err.message || 'Failed to create property.' });
//   }
// };

// // PUT /api/properties/:id  (Edit Property — re-routes team/agent if state changes, and drives
// // the deal-lifecycle automation described below when `status` changes)
// //
// // Status lifecycle automation:
// //   -> 'Complete'    : deal is WON.  Delete ALL tasks tied to this property, set pipeline
// //                      stage to 'Closed - Won'.
// //   -> 'Cancelled'   : deal is LOST. Delete ALL tasks tied to this property, set pipeline
// //                      stage to 'Closed - Lost'.
// //   -> 'On Process'  : deal is REOPENED (only meaningful coming from Complete/Cancelled).
// //                      Delete any leftover tasks, reset pipeline stage to 'New Lead', and
// //                      recreate a fresh "Review Property Info" task so the deal starts over
// //                      exactly where it would after the property was first recorded.
// // This same logic is shared with taskController — marking "Contract Signing" Done fires
// // the exact same closeDealWon() function used here.
// exports.updateProperty = async (req, res) => {
//   const conn = await pool.getConnection();
//   try {
//     const { id } = req.params;
//     const {
//       property_address, state, county, room, bathrooms,
//       market_value, property_type, property_condition, status
//     } = req.body;

//     const [existingRows] = await conn.query('SELECT * FROM properties WHERE id = ?', [id]);
//     if (existingRows.length === 0) {
//       conn.release();
//       return res.status(404).json({ message: 'Property not found.' });
//     }
//     const existing = existingRows[0];

//     const finalAddress = property_address ?? existing.property_address;
//     const finalCounty = county ?? existing.county;
//     const finalRoom = room ?? existing.room;
//     const finalBathrooms = bathrooms ?? existing.bathrooms;
//     const finalMarketValue = market_value ?? existing.market_value;
//     const finalStatus = status ?? existing.status;

//     const validationError = firstError([
//       [validateRequiredText, finalAddress, 'Property address'],
//       [validateRequiredText, finalCounty, 'County'],
//       [validateNonNegativeNumber, finalRoom, 'Rooms'],
//       [validateNonNegativeNumber, finalBathrooms, 'Bathrooms'],
//       [validateNonNegativeNumber, finalMarketValue, 'Market value']
//     ]);
//     if (validationError) {
//       conn.release();
//       return res.status(400).json({ message: validationError });
//     }

//     let employeeId = existing.employee_id;
//     let reassignedNote = '';
//     if (state && state !== existing.state) {
//       const agent = await assignAgentForState(state);
//       employeeId = agent.id;
//       reassignedNote = ` Re-routed to ${agent.team} (${agent.name}) due to state change.`;
//     }

//     await conn.beginTransaction();

//     await conn.query(
//       `UPDATE properties SET
//         property_address = ?, state = ?, county = ?, room = ?, bathrooms = ?,
//         market_value = ?, property_type = ?, property_condition = ?, status = ?, employee_id = ?
//        WHERE id = ?`,
//       [
//         finalAddress,
//         state ?? existing.state,
//         finalCounty,
//         finalRoom,
//         finalBathrooms,
//         finalMarketValue,
//         property_type ?? existing.property_type,
//         property_condition ?? existing.property_condition,
//         finalStatus,
//         employeeId,
//         id
//       ]
//     );

//     let lifecycleNote = '';
//     const statusChanged = finalStatus !== existing.status;

//     if (statusChanged && finalStatus === 'Complete') {
//       lifecycleNote = await closeDealWon(conn, { sellerId: existing.seller_id, propertyId: id });
//     } else if (statusChanged && finalStatus === 'Cancelled') {
//       lifecycleNote = await closeDealLost(conn, { sellerId: existing.seller_id, propertyId: id });
//     } else if (statusChanged && finalStatus === 'On Process') {
//       lifecycleNote = await reopenDeal(conn, { sellerId: existing.seller_id, propertyId: id, employeeId });
//     }

//     await conn.commit();
//     conn.release();

//     await logActivity(req.user.id, `Updated property "${existing.property_address}".${reassignedNote}${lifecycleNote}`);

//     const [rows] = await pool.query(
//       `SELECT p.*, s.name AS seller_name, e.name AS agent_name, e.team AS team, sp.stage AS stage
//        FROM properties p
//        JOIN sellers s ON s.id = p.seller_id
//        JOIN employees e ON e.id = p.employee_id
//        LEFT JOIN sales_pipeline sp ON sp.property_id = p.id
//        WHERE p.id = ?`,
//       [id]
//     );
//     res.json(rows[0]);
//   } catch (err) {
//     await conn.rollback();
//     conn.release();
//     console.error(err);
//     res.status(500).json({ message: err.message || 'Failed to update property.' });
//   }
// };