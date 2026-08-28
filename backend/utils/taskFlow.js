/**
 * The full task -> task -> task automation chain, as described by the business rules:
 *
 * Seller registered            -> Task: "Get Property Info"              (Team Acquisition)
 * Property recorded            -> Stage: New Lead   | Task: "Review Property Info"
 * Review Property Info done    -> Stage: Appointment | Task: "Set Schedule for On-site Inspection"
 * Schedule set (done)          -> Stage: Appointment | Task: "On-site Inspection"
 * On-site Inspection done      -> Stage: Appointment | Task: "Update or Confirm Property Details"
 * Details confirmed (done)     -> Stage: Offer       | Task: "Send Offer to Seller"
 * Offer sent (done)            -> Stage: Offer       | Task: "Negotiate the Offer"
 * Negotiation done             -> Stage: Contract    | Task: "Contract Signing"
 * Contract Signing done        -> Stage: Closed - Won | (no further task)
 *
 * Every task in this chain (after the initial acquisition task) is assigned to the
 * SAME agent that is attached to the property (properties.employee_id), all the way
 * through to close, per the business rule.
 */

const TASK_NAMES = {
  GET_PROPERTY_INFO: 'Get Property Info',
  REVIEW_PROPERTY_INFO: 'Review Property Info',
  SET_SCHEDULE: 'Set Schedule for On-site Inspection',
  ONSITE_INSPECTION: 'On-site Inspection',
  UPDATE_CONFIRM_DETAILS: 'Update or Confirm Property Details',
  SEND_OFFER: 'Send Offer to Seller',
  NEGOTIATE_OFFER: 'Negotiate the Offer',
  CONTRACT_SIGNING: 'Contract Signing'
};

// key = task that was just marked "Done" -> what happens next
const TASK_FLOW = {
  [TASK_NAMES.GET_PROPERTY_INFO]: {
    nextTask: TASK_NAMES.REVIEW_PROPERTY_INFO,
    nextStage: 'Contacted'
  },
  [TASK_NAMES.REVIEW_PROPERTY_INFO]: {
    nextTask: TASK_NAMES.SET_SCHEDULE,
    nextStage: 'Appointment'
  },
  [TASK_NAMES.SET_SCHEDULE]: {
    nextTask: TASK_NAMES.ONSITE_INSPECTION,
    nextStage: 'Appointment'
  },
  [TASK_NAMES.ONSITE_INSPECTION]: {
    nextTask: TASK_NAMES.UPDATE_CONFIRM_DETAILS,
    nextStage: 'Appointment'
  },
  [TASK_NAMES.UPDATE_CONFIRM_DETAILS]: {
    nextTask: TASK_NAMES.SEND_OFFER,
    nextStage: 'Offer'
  },
  [TASK_NAMES.SEND_OFFER]: {
    nextTask: TASK_NAMES.NEGOTIATE_OFFER,
    nextStage: 'Offer'
  },
  [TASK_NAMES.NEGOTIATE_OFFER]: {
    nextTask: TASK_NAMES.CONTRACT_SIGNING,
    nextStage: 'Under Contract'
  },
  [TASK_NAMES.CONTRACT_SIGNING]: {
    nextTask: null,
    nextStage: 'Closed'
  }
};

// The full ordered list, used to populate the "Task" dropdown in Edit Task
const ALL_TASK_NAMES = Object.values(TASK_NAMES);

/**
 * REVERSE lookup: for a given task name, what stage was active right before that task
 * was completed (i.e. the stage that should be restored if this task gets UN-checked).
 * Derived automatically from TASK_FLOW, plus one manual entry for the very first task
 * in the chain, since its "before" stage comes from property creation, not another task.
 */
const STAGE_BEFORE_TASK = {
  [TASK_NAMES.REVIEW_PROPERTY_INFO]: 'New Lead'
};
for (const flow of Object.values(TASK_FLOW)) {
  if (flow.nextTask) {
    STAGE_BEFORE_TASK[flow.nextTask] = flow.nextStage;
  }
}

/**
 * Given a task name, returns the ordered list of task names that come AFTER it in the
 * chain (not including itself). Used when a task gets un-checked: everything downstream
 * of it is no longer valid and should be removed, since its prerequisite is no longer met.
 */
function getDownstreamTaskNames(taskName) {
  const names = [];
  let current = TASK_FLOW[taskName]?.nextTask;
  while (current) {
    names.push(current);
    current = TASK_FLOW[current]?.nextTask;
  }
  return names;
}

module.exports = { TASK_NAMES, TASK_FLOW, ALL_TASK_NAMES, STAGE_BEFORE_TASK, getDownstreamTaskNames };







//NECROWL

// /**
//  * The full task -> task -> task automation chain, as described by the business rules:
//  *
//  * Seller registered            -> Task: "Get Property Info"              (Team Acquisition)
//  * Property recorded            -> Stage: New Lead   | Task: "Review Property Info"
//  * Review Property Info done    -> Stage: Appointment | Task: "Set Schedule for On-site Inspection"
//  * Schedule set (done)          -> Stage: Appointment | Task: "On-site Inspection"
//  * On-site Inspection done      -> Stage: Appointment | Task: "Update or Confirm Property Details"
//  * Details confirmed (done)     -> Stage: Offer       | Task: "Send Offer to Seller"
//  * Offer sent (done)            -> Stage: Offer       | Task: "Negotiate the Offer"
//  * Negotiation done             -> Stage: Contract    | Task: "Contract Signing"
//  * Contract Signing done        -> Stage: Closed - Won | (no further task)
//  *
//  * Every task in this chain (after the initial acquisition task) is assigned to the
//  * SAME agent that is attached to the property (properties.employee_id), all the way
//  * through to close, per the business rule.
//  */

// const TASK_NAMES = {
//   GET_PROPERTY_INFO: 'Get Property Info',
//   REVIEW_PROPERTY_INFO: 'Review Property Info',
//   SET_SCHEDULE: 'Set Schedule for On-site Inspection',
//   ONSITE_INSPECTION: 'On-site Inspection',
//   UPDATE_CONFIRM_DETAILS: 'Update or Confirm Property Details',
//   SEND_OFFER: 'Send Offer to Seller',
//   NEGOTIATE_OFFER: 'Negotiate the Offer',
//   CONTRACT_SIGNING: 'Contract Signing'
// };

// // key = task that was just marked "Done" -> what happens next
// const TASK_FLOW = {
//   [TASK_NAMES.GET_PROPERTY_INFO]: {
//     nextTask: TASK_NAMES.REVIEW_PROPERTY_INFO,
//     nextStage: 'Qualify'
//   },
//   [TASK_NAMES.REVIEW_PROPERTY_INFO]: {
//     nextTask: TASK_NAMES.SET_SCHEDULE,
//     nextStage: 'Appointment'
//   },
//   [TASK_NAMES.SET_SCHEDULE]: {
//     nextTask: TASK_NAMES.ONSITE_INSPECTION,
//     nextStage: 'Appointment'
//   },
//   [TASK_NAMES.ONSITE_INSPECTION]: {
//     nextTask: TASK_NAMES.UPDATE_CONFIRM_DETAILS,
//     nextStage: 'Appointment'
//   },
//   [TASK_NAMES.UPDATE_CONFIRM_DETAILS]: {
//     nextTask: TASK_NAMES.SEND_OFFER,
//     nextStage: 'Offer'
//   },
//   [TASK_NAMES.SEND_OFFER]: {
//     nextTask: TASK_NAMES.NEGOTIATE_OFFER,
//     nextStage: 'Offer'
//   },
//   [TASK_NAMES.NEGOTIATE_OFFER]: {
//     nextTask: TASK_NAMES.CONTRACT_SIGNING,
//     nextStage: 'Contract'
//   },
//   [TASK_NAMES.CONTRACT_SIGNING]: {
//     nextTask: null,
//     nextStage: 'Closed - Won'
//   }
// };

// // The full ordered list, used to populate the "Task" dropdown in Edit Task
// const ALL_TASK_NAMES = Object.values(TASK_NAMES);

// /**
//  * REVERSE lookup: for a given task name, what stage was active right before that task
//  * was completed (i.e. the stage that should be restored if this task gets UN-checked).
//  * Derived automatically from TASK_FLOW, plus one manual entry for the very first task
//  * in the chain, since its "before" stage comes from property creation, not another task.
//  */
// const STAGE_BEFORE_TASK = {
//   [TASK_NAMES.REVIEW_PROPERTY_INFO]: 'New Lead'
// };
// for (const flow of Object.values(TASK_FLOW)) {
//   if (flow.nextTask) {
//     STAGE_BEFORE_TASK[flow.nextTask] = flow.nextStage;
//   }
// }

// /**
//  * Given a task name, returns the ordered list of task names that come AFTER it in the
//  * chain (not including itself). Used when a task gets un-checked: everything downstream
//  * of it is no longer valid and should be removed, since its prerequisite is no longer met.
//  */
// function getDownstreamTaskNames(taskName) {
//   const names = [];
//   let current = TASK_FLOW[taskName]?.nextTask;
//   while (current) {
//     names.push(current);
//     current = TASK_FLOW[current]?.nextTask;
//   }
//   return names;
// }

// module.exports = { TASK_NAMES, TASK_FLOW, ALL_TASK_NAMES, STAGE_BEFORE_TASK, getDownstreamTaskNames };