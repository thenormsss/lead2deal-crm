const { TASK_NAMES, TASK_FLOW } = require('./taskFlow');
const { getNextDayDateString, getRandomAvailableTimeSlot } = require('./scheduling');

/**
 * Shared deal-closing/reopening logic, used by BOTH:
 *  - propertyController (when someone manually sets Property status to Complete/Cancelled/On Process)
 *  - taskController (when "Contract Signing" — the last task in the chain — is marked Done,
 *    which should close the deal exactly the same way as if you'd set status manually)
 * Keeping this in one place means both entry points can never drift out of sync.
 */

// A seller can have MULTIPLE properties. "Get Property Info" is a one-time, seller-level
// task (property_id IS NULL) — it should only be cleaned up once there are no OTHER
// properties still actively "On Process" for this seller, so closing one property doesn't
// wipe out a task that's still relevant to another property still in progress.
async function cleanUpSellerAcquisitionTaskIfNoOtherActiveProperties(conn, sellerId, excludePropertyId) {
  const [otherActiveRows] = await conn.query(
    "SELECT COUNT(*) AS count FROM properties WHERE seller_id = ? AND id != ? AND status = 'On Process'",
    [sellerId, excludePropertyId]
  );
  if (otherActiveRows[0].count > 0) return '';

  const [delResult] = await conn.query(
    'DELETE FROM tasks WHERE seller_id = ? AND task = ? AND property_id IS NULL',
    [sellerId, TASK_NAMES.GET_PROPERTY_INFO]
  );
  return delResult.affectedRows > 0
    ? ' Seller\'s "Get Property Info" task removed (no other active properties remain).'
    : '';
}

// Closes a deal as WON: property status -> Complete, pipeline stage -> Closed - Won,
// deletes every remaining task tied to the property (including whichever task triggered
// this, e.g. "Contract Signing"), and cleans up the seller's acquisition task if this was
// their last active property.
async function closeDealWon(conn, { sellerId, propertyId }) {
  await conn.query("UPDATE properties SET status = 'Complete' WHERE id = ?", [propertyId]);
  await conn.query("UPDATE sales_pipeline SET stage = 'Closed - Won' WHERE property_id = ?", [propertyId]);
  const [delResult] = await conn.query('DELETE FROM tasks WHERE property_id = ?', [propertyId]);
  const gpiNote = await cleanUpSellerAcquisitionTaskIfNoOtherActiveProperties(conn, sellerId, propertyId);
  return ` Deal closed — WON. Property status set to "Complete", pipeline stage set to "Closed - Won", removed ${delResult.affectedRows} task(s).${gpiNote}`;
}

// Closes a deal as LOST: property status -> Cancelled, pipeline stage -> Closed - Lost,
// deletes every remaining task tied to the property, and cleans up the seller's
// acquisition task if this was their last active property.
async function closeDealLost(conn, { sellerId, propertyId }) {
  await conn.query("UPDATE properties SET status = 'Cancelled' WHERE id = ?", [propertyId]);
  await conn.query("UPDATE sales_pipeline SET stage = 'Closed - Lost' WHERE property_id = ?", [propertyId]);
  const [delResult] = await conn.query('DELETE FROM tasks WHERE property_id = ?', [propertyId]);
  const gpiNote = await cleanUpSellerAcquisitionTaskIfNoOtherActiveProperties(conn, sellerId, propertyId);
  return ` Deal closed — LOST. Property status set to "Cancelled", pipeline stage set to "Closed - Lost", removed ${delResult.affectedRows} task(s).${gpiNote}`;
}

// Reopens a deal: property status -> On Process, pipeline stage -> whatever TASK_FLOW
// says the stage should be right after "Get Property Info" (e.g. "Qualify"), deletes any
// leftover tasks, and recreates the corresponding next task (e.g. "Review Property Info")
// assigned to the given agent — the deal restarts exactly where it would right after the
// property was first recorded. Reads TASK_FLOW dynamically instead of hardcoding, so it
// stays in sync with propertyController.createProperty automatically.
async function reopenDeal(conn, { sellerId, propertyId, employeeId }) {
  const gpiFlow = TASK_FLOW[TASK_NAMES.GET_PROPERTY_INFO] || {};
  const restartStage = gpiFlow.nextStage || 'New Lead';
  const restartTask = gpiFlow.nextTask || TASK_NAMES.REVIEW_PROPERTY_INFO;

  await conn.query("UPDATE properties SET status = 'On Process' WHERE id = ?", [propertyId]);
  await conn.query('UPDATE sales_pipeline SET stage = ? WHERE property_id = ?', [restartStage, propertyId]);
  const [delResult] = await conn.query('DELETE FROM tasks WHERE property_id = ?', [propertyId]);
  const dueDate = getNextDayDateString();
  const dueTime = await getRandomAvailableTimeSlot(conn, employeeId, dueDate);
  await conn.query(
    `INSERT INTO tasks (task, seller_id, property_id, task_date, task_time, assigned_to, status)
     VALUES (?, ?, ?, ?, ?, ?, 'Not Done')`,
    [restartTask, sellerId, propertyId, dueDate, dueTime, employeeId]
  );
  return ` Deal reopened: removed ${delResult.affectedRows} old task(s), pipeline stage reset to "${restartStage}", and "${restartTask}" recreated.`;
}

module.exports = {
  closeDealWon,
  closeDealLost,
  reopenDeal,
  cleanUpSellerAcquisitionTaskIfNoOtherActiveProperties
};











// const { TASK_NAMES } = require('./taskFlow');
// const { getNextDayDateString, getRandomAvailableTimeSlot } = require('./scheduling');

// /**
//  * Shared deal-closing/reopening logic, used by BOTH:
//  *  - propertyController (when someone manually sets Property status to Complete/Cancelled/On Process)
//  *  - taskController (when "Contract Signing" — the last task in the chain — is marked Done,
//  *    which should close the deal exactly the same way as if you'd set status manually)
//  * Keeping this in one place means both entry points can never drift out of sync.
//  */

// // A seller can have MULTIPLE properties. "Get Property Info" is a one-time, seller-level
// // task (property_id IS NULL) — it should only be cleaned up once there are no OTHER
// // properties still actively "On Process" for this seller, so closing one property doesn't
// // wipe out a task that's still relevant to another property still in progress.
// async function cleanUpSellerAcquisitionTaskIfNoOtherActiveProperties(conn, sellerId, excludePropertyId) {
//   const [otherActiveRows] = await conn.query(
//     "SELECT COUNT(*) AS count FROM properties WHERE seller_id = ? AND id != ? AND status = 'On Process'",
//     [sellerId, excludePropertyId]
//   );
//   if (otherActiveRows[0].count > 0) return '';

//   const [delResult] = await conn.query(
//     'DELETE FROM tasks WHERE seller_id = ? AND task = ? AND property_id IS NULL',
//     [sellerId, TASK_NAMES.GET_PROPERTY_INFO]
//   );
//   return delResult.affectedRows > 0
//     ? ' Seller\'s "Get Property Info" task removed (no other active properties remain).'
//     : '';
// }

// // Closes a deal as WON: property status -> Complete, pipeline stage -> Closed - Won,
// // deletes every remaining task tied to the property (including whichever task triggered
// // this, e.g. "Contract Signing"), and cleans up the seller's acquisition task if this was
// // their last active property.
// async function closeDealWon(conn, { sellerId, propertyId }) {
//   await conn.query("UPDATE properties SET status = 'Complete' WHERE id = ?", [propertyId]);
//   await conn.query("UPDATE sales_pipeline SET stage = 'Closed - Won' WHERE property_id = ?", [propertyId]);
//   const [delResult] = await conn.query('DELETE FROM tasks WHERE property_id = ?', [propertyId]);
//   const gpiNote = await cleanUpSellerAcquisitionTaskIfNoOtherActiveProperties(conn, sellerId, propertyId);
//   return ` Deal closed — WON. Property status set to "Complete", pipeline stage set to "Closed - Won", removed ${delResult.affectedRows} task(s).${gpiNote}`;
// }

// // Closes a deal as LOST: property status -> Cancelled, pipeline stage -> Closed - Lost,
// // deletes every remaining task tied to the property, and cleans up the seller's
// // acquisition task if this was their last active property.
// async function closeDealLost(conn, { sellerId, propertyId }) {
//   await conn.query("UPDATE properties SET status = 'Cancelled' WHERE id = ?", [propertyId]);
//   await conn.query("UPDATE sales_pipeline SET stage = 'Closed - Lost' WHERE property_id = ?", [propertyId]);
//   const [delResult] = await conn.query('DELETE FROM tasks WHERE property_id = ?', [propertyId]);
//   const gpiNote = await cleanUpSellerAcquisitionTaskIfNoOtherActiveProperties(conn, sellerId, propertyId);
//   return ` Deal closed — LOST. Property status set to "Cancelled", pipeline stage set to "Closed - Lost", removed ${delResult.affectedRows} task(s).${gpiNote}`;
// }

// // Reopens a deal: property status -> On Process, pipeline stage -> New Lead, deletes any
// // leftover tasks, and recreates "Review Property Info" assigned to the given agent — the
// // deal restarts exactly where it would right after the property was first recorded.
// async function reopenDeal(conn, { sellerId, propertyId, employeeId }) {
//   await conn.query("UPDATE properties SET status = 'On Process' WHERE id = ?", [propertyId]);
//   await conn.query("UPDATE sales_pipeline SET stage = 'Qualify' WHERE property_id = ?", [propertyId]);
//   const [delResult] = await conn.query('DELETE FROM tasks WHERE property_id = ?', [propertyId]);
//   const dueDate = getNextDayDateString();
//   const dueTime = await getRandomAvailableTimeSlot(conn, employeeId, dueDate);
//   await conn.query(
//     `INSERT INTO tasks (task, seller_id, property_id, task_date, task_time, assigned_to, status)
//      VALUES (?, ?, ?, ?, ?, ?, 'Not Done')`,
//     [TASK_NAMES.REVIEW_PROPERTY_INFO, sellerId, propertyId, dueDate, dueTime, employeeId]
//   );
//   return ` Deal reopened: removed ${delResult.affectedRows} old task(s), pipeline stage reset to "New Lead", and "Review Property Info" recreated.`;
// }

// module.exports = {
//   closeDealWon,
//   closeDealLost,
//   reopenDeal,
//   cleanUpSellerAcquisitionTaskIfNoOtherActiveProperties
// };































// const { TASK_NAMES } = require('./taskFlow');

// /**
//  * Shared deal-closing/reopening logic, used by BOTH:
//  *  - propertyController (when someone manually sets Property status to Complete/Cancelled/On Process)
//  *  - taskController (when "Contract Signing" — the last task in the chain — is marked Done,
//  *    which should close the deal exactly the same way as if you'd set status manually)
//  * Keeping this in one place means both entry points can never drift out of sync.
//  */

// // A seller can have MULTIPLE properties. "Get Property Info" is a one-time, seller-level
// // task (property_id IS NULL) — it should only be cleaned up once there are no OTHER
// // properties still actively "On Process" for this seller, so closing one property doesn't
// // wipe out a task that's still relevant to another property still in progress.
// async function cleanUpSellerAcquisitionTaskIfNoOtherActiveProperties(conn, sellerId, excludePropertyId) {
//   const [otherActiveRows] = await conn.query(
//     "SELECT COUNT(*) AS count FROM properties WHERE seller_id = ? AND id != ? AND status = 'On Process'",
//     [sellerId, excludePropertyId]
//   );
//   if (otherActiveRows[0].count > 0) return '';

//   const [delResult] = await conn.query(
//     'DELETE FROM tasks WHERE seller_id = ? AND task = ? AND property_id IS NULL',
//     [sellerId, TASK_NAMES.GET_PROPERTY_INFO]
//   );
//   return delResult.affectedRows > 0
//     ? ' Seller\'s "Get Property Info" task removed (no other active properties remain).'
//     : '';
// }

// // Closes a deal as WON: property status -> Complete, pipeline stage -> Closed - Won,
// // deletes every remaining task tied to the property (including whichever task triggered
// // this, e.g. "Contract Signing"), and cleans up the seller's acquisition task if this was
// // their last active property.
// async function closeDealWon(conn, { sellerId, propertyId }) {
//   await conn.query("UPDATE properties SET status = 'Complete' WHERE id = ?", [propertyId]);
//   await conn.query("UPDATE sales_pipeline SET stage = 'Closed - Won' WHERE property_id = ?", [propertyId]);
//   const [delResult] = await conn.query('DELETE FROM tasks WHERE property_id = ?', [propertyId]);
//   const gpiNote = await cleanUpSellerAcquisitionTaskIfNoOtherActiveProperties(conn, sellerId, propertyId);
//   return ` Deal closed — WON. Property status set to "Complete", pipeline stage set to "Closed - Won", removed ${delResult.affectedRows} task(s).${gpiNote}`;
// }

// // Closes a deal as LOST: property status -> Cancelled, pipeline stage -> Closed - Lost,
// // deletes every remaining task tied to the property, and cleans up the seller's
// // acquisition task if this was their last active property.
// async function closeDealLost(conn, { sellerId, propertyId }) {
//   await conn.query("UPDATE properties SET status = 'Cancelled' WHERE id = ?", [propertyId]);
//   await conn.query("UPDATE sales_pipeline SET stage = 'Closed - Lost' WHERE property_id = ?", [propertyId]);
//   const [delResult] = await conn.query('DELETE FROM tasks WHERE property_id = ?', [propertyId]);
//   const gpiNote = await cleanUpSellerAcquisitionTaskIfNoOtherActiveProperties(conn, sellerId, propertyId);
//   return ` Deal closed — LOST. Property status set to "Cancelled", pipeline stage set to "Closed - Lost", removed ${delResult.affectedRows} task(s).${gpiNote}`;
// }

// // Reopens a deal: property status -> On Process, pipeline stage -> New Lead, deletes any
// // leftover tasks, and recreates "Review Property Info" assigned to the given agent — the
// // deal restarts exactly where it would right after the property was first recorded.
// async function reopenDeal(conn, { sellerId, propertyId, employeeId }) {
//   await conn.query("UPDATE properties SET status = 'On Process' WHERE id = ?", [propertyId]);
//   await conn.query("UPDATE sales_pipeline SET stage = 'New Lead' WHERE property_id = ?", [propertyId]);
//   const [delResult] = await conn.query('DELETE FROM tasks WHERE property_id = ?', [propertyId]);
//   const today = new Date().toISOString().slice(0, 10);
//   await conn.query(
//     `INSERT INTO tasks (task, seller_id, property_id, task_date, task_time, assigned_to, status)
//      VALUES (?, ?, ?, ?, '09:00:00', ?, 'Not Done')`,
//     [TASK_NAMES.REVIEW_PROPERTY_INFO, sellerId, propertyId, today, employeeId]
//   );
//   return ` Deal reopened: removed ${delResult.affectedRows} old task(s), pipeline stage reset to "New Lead", and "Review Property Info" recreated.`;
// }

// module.exports = {
//   closeDealWon,
//   closeDealLost,
//   reopenDeal,
//   cleanUpSellerAcquisitionTaskIfNoOtherActiveProperties
// };