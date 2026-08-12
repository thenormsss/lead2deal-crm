const mysql = require('mysql2/promise');
require('dotenv').config();

// Connection pool shared across the whole app
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true // keep DATE/TIME columns as plain strings (avoids TZ shifting)
});

module.exports = pool;
