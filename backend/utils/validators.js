/**
 * Shared field-level validators used across controllers.
 * Every function returns null if valid, or an error message string if invalid.
 */

// Accepts PH mobile (09XXXXXXXXX), landlines, and international numbers with an
// optional leading "+". Strips spaces/dashes/parentheses before checking length.
// const PHONE_REGEX = /^\+?\d{7,15}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// function validatePhone(phone) {
//   if (!phone) return 'Phone number is required.';
//   const normalized = phone.trim().replace(/[\s\-()]/g, '');
//   if (!PHONE_REGEX.test(normalized)) {
//     return 'Phone number must be 7–15 digits, optionally starting with + (e.g. 09123456789 or +1 555 123 4567).';
//   }
//   return null;
// }

function validateEmail(email) {
  // email is optional across the app — only validate format if something was entered
  if (!email) return null;
  if (!EMAIL_REGEX.test(email.trim())) {
    return 'Please enter a valid email address (e.g. name@example.com).';
  }
  return null;
}

function validateNonNegativeNumber(value, fieldLabel) {
  if (value === undefined || value === null || value === '') return null; // optional fields default to 0
  const num = Number(value);
  if (Number.isNaN(num)) return `${fieldLabel} must be a number.`;
  if (num < 0) return `${fieldLabel} cannot be negative.`;
  return null;
}

// Same as validateNonNegativeNumber but also rejects anything above a sane ceiling —
// catches obvious typos (e.g. 9999999999 rooms) without hardcoding this into every caller.
function validateNumberInRange(value, fieldLabel, max) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (Number.isNaN(num)) return `${fieldLabel} must be a number.`;
  if (num < 0) return `${fieldLabel} cannot be negative.`;
  if (num > max) return `${fieldLabel} seems too high (max ${max.toLocaleString()}).`;
  return null;
}

function validateRequiredText(value, fieldLabel) {
  if (!value || !String(value).trim()) return `${fieldLabel} is required.`;
  return null;
}

function validateMaxLength(value, maxLength, fieldLabel) {
  if (!value) return null; // required-ness is checked separately
  if (String(value).trim().length > maxLength) {
    return `${fieldLabel} must be ${maxLength} characters or fewer.`;
  }
  return null;
}

// Whitelist check — used for fields backed by a MySQL/MariaDB ENUM column, so a bad or
// unexpected value never reaches the database (where it would otherwise throw a raw SQL error).
function validateEnum(value, allowedValues, fieldLabel) {
  if (value === undefined || value === null || value === '') return null; // required-ness is checked separately
  if (!allowedValues.includes(value)) {
    return `${fieldLabel} must be one of: ${allowedValues.join(', ')}.`;
  }
  return null;
}

function validateDate(dateStr, fieldLabel) {
  if (!dateStr) return `${fieldLabel} is required.`;
  const isValidFormat = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  if (!isValidFormat || Number.isNaN(new Date(dateStr).getTime())) {
    return `${fieldLabel} must be a valid date.`;
  }
  return null;
}

function validateTime(timeStr, fieldLabel) {
  if (!timeStr) return `${fieldLabel} is required.`;
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(timeStr)) {
    return `${fieldLabel} must be a valid time (HH:MM).`;
  }
  return null;
}

// Runs a list of [value, validatorFn, ...args] checks and returns the first error found, or null
function firstError(checks) {
  for (const [validatorFn, ...args] of checks) {
    const err = validatorFn(...args);
    if (err) return err;
  }
  return null;
}

module.exports = {
  // validatePhone,
  validateEmail,
  validateNonNegativeNumber,
  validateNumberInRange,
  validateRequiredText,
  validateMaxLength,
  validateEnum,
  validateDate,
  validateTime,
  firstError
};








// /**
//  * Shared field-level validators used across controllers.
//  * Every function returns null if valid, or an error message string if invalid.
//  */

// // PH mobile format: 09XXXXXXXXX (11 digits, starts with 09) — matches the mockup's
// // placeholder "09123456789". Adjust the regex here if you need international numbers too.
// pattern="09[0-9]{9}"
// title="Phone must be 11 digits starting with 09, e.g. 09123456789"

// function validatePhone(phone) {
//   if (!phone) return 'Phone number is required.';
//   if (!PHONE_REGEX.test(phone.trim())) {
//     return 'Phone number must be 11 digits starting with 09 (e.g. 09123456789).';
//   }
//   return null;
// }

// function validateEmail(email) {
//   // email is optional across the app — only validate format if something was entered
//   if (!email) return null;
//   if (!EMAIL_REGEX.test(email.trim())) {
//     return 'Please enter a valid email address (e.g. name@example.com).';
//   }
//   return null;
// }

// function validateNonNegativeNumber(value, fieldLabel) {
//   if (value === undefined || value === null || value === '') return null; // optional fields default to 0
//   const num = Number(value);
//   if (Number.isNaN(num)) return `${fieldLabel} must be a number.`;
//   if (num < 0) return `${fieldLabel} cannot be negative.`;
//   return null;
// }

// function validateRequiredText(value, fieldLabel) {
//   if (!value || !String(value).trim()) return `${fieldLabel} is required.`;
//   return null;
// }

// function validateDate(dateStr, fieldLabel) {
//   if (!dateStr) return `${fieldLabel} is required.`;
//   const isValidFormat = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
//   if (!isValidFormat || Number.isNaN(new Date(dateStr).getTime())) {
//     return `${fieldLabel} must be a valid date.`;
//   }
//   return null;
// }

// function validateTime(timeStr, fieldLabel) {
//   if (!timeStr) return `${fieldLabel} is required.`;
//   if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(timeStr)) {
//     return `${fieldLabel} must be a valid time (HH:MM).`;
//   }
//   return null;
// }

// // Runs a list of [value, validatorFn, ...args] checks and returns the first error found, or null
// function firstError(checks) {
//   for (const [validatorFn, ...args] of checks) {
//     const err = validatorFn(...args);
//     if (err) return err;
//   }
//   return null;
// }

// module.exports = {
//   validatePhone,
//   validateEmail,
//   validateNonNegativeNumber,
//   validateRequiredText,
//   validateDate,
//   validateTime,
//   firstError
// };