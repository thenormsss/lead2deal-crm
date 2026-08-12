/**
 * CLI helper for the admin to generate a bcrypt hash for a new employee's password,
 * since there is no self-service registration module.
 *
 * Usage:  node utils/hashPassword.js "thePlainTextPassword"
 * Then:   INSERT INTO employees (name, username, password, team) VALUES (...)
 */
const bcrypt = require('bcryptjs');

const plain = process.argv[2];
if (!plain) {
  console.error('Usage: node utils/hashPassword.js "yourPassword"');
  process.exit(1);
}

bcrypt.hash(plain, 10).then((hash) => {
  console.log('\nBcrypt hash (paste this into employees.password):\n');
  console.log(hash, '\n');
});
