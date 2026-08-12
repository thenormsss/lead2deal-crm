/**
 * Shared scheduling logic for every auto-generated task in the system.
 * Used by sellerController, propertyController, taskController, and dealLifecycle
 * wherever a task gets created automatically (never for manual edits — those keep
 * whatever date/time the user picks).
 */

const BUSINESS_START_HOUR = 8;  // 8:00 AM
const BUSINESS_END_HOUR = 17;   // 5:00 PM (exclusive — last slot starts at 16:40)
const SLOT_INTERVAL_MINUTES = 20;

// Every auto-generated task is due the NEXT day, not the same day it was created.
function getNextDayDateString() {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return tomorrow.toISOString().slice(0, 10);
}

// The full fixed grid of times for a business day, spaced SLOT_INTERVAL_MINUTES apart
// (08:00, 08:20, 08:40, 09:00, ... 16:40). Because every task only ever gets assigned one
// of these fixed grid slots, any two different slots are automatically at least
// SLOT_INTERVAL_MINUTES apart — no separate gap-checking needed.
function buildDailyTimeSlots() {
  const slots = [];
  for (let hour = BUSINESS_START_HOUR; hour < BUSINESS_END_HOUR; hour++) {
    for (let minute = 0; minute < 60; minute += SLOT_INTERVAL_MINUTES) {
      const hh = String(hour).padStart(2, '0');
      const mm = String(minute).padStart(2, '0');
      slots.push(`${hh}:${mm}:00`);
    }
  }
  return slots;
}

/**
 * Picks a random due time for `employeeId` on `dueDate` that isn't already taken by one
 * of their OTHER tasks that same day. Must be run inside the same transaction (`conn`)
 * that will insert the new task, so the "already taken" check is accurate.
 */
async function getRandomAvailableTimeSlot(conn, employeeId, dueDate) {
  const [takenRows] = await conn.query(
    'SELECT task_time FROM tasks WHERE assigned_to = ? AND task_date = ?',
    [employeeId, dueDate]
  );
  const takenTimes = new Set(takenRows.map((r) => r.task_time));

  const allSlots = buildDailyTimeSlots();
  const availableSlots = allSlots.filter((slot) => !takenTimes.has(slot));

  if (availableSlots.length === 0) {
    // Extremely unlikely (would mean 27+ tasks for one agent on a single day) — fall back
    // to a random slot anyway rather than failing the whole operation.
    return allSlots[Math.floor(Math.random() * allSlots.length)];
  }

  return availableSlots[Math.floor(Math.random() * availableSlots.length)];
}

module.exports = { getNextDayDateString, getRandomAvailableTimeSlot };