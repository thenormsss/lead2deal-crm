const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// Decides cookie security per-request instead of one fixed NODE_ENV setting, so the same
// backend works correctly whether it's hit over plain HTTP on localhost (local dev) or
// over real HTTPS through a tunnel/host like ngrok or Railway (deployed).
// req.secure is accurate here because server.js sets `trust proxy`, which makes Express
// read the X-Forwarded-Proto header that ngrok/Railway set, rather than only looking at
// the plain HTTP connection it receives internally.
function getCookieOptions(req) {
  const isSecureRequest = req.secure;
  return {
    httpOnly: true,
    secure: isSecureRequest,
    sameSite: isSecureRequest ? 'none' : 'lax',
    maxAge: 8 * 60 * 60 * 1000 // 8 hours
  };
}

// POST /api/auth/login
exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required.' });
    }

    const [rows] = await pool.query('SELECT * FROM employees WHERE username = ?', [username]);
    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    const employee = rows[0];
    const match = await bcrypt.compare(password, employee.password);
    if (!match) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    const payload = {
      id: employee.id,
      name: employee.name,
      username: employee.username,
      team: employee.team
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h'
    });

    res.cookie('token', token, getCookieOptions(req));
    res.json({ message: 'Logged in', user: payload });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error during login.' });
  }
};

// POST /api/auth/logout
exports.logout = (req, res) => {
  // clearCookie must be called with the SAME options (secure/sameSite) used to set the
  // cookie, or the browser won't recognize it as the same cookie to remove.
  res.clearCookie('token', getCookieOptions(req));
  res.json({ message: 'Logged out' });
};

// GET /api/auth/me
exports.me = (req, res) => {
  res.json({ user: req.user });
};





// const bcrypt = require('bcryptjs');
// const jwt = require('jsonwebtoken');
// const pool = require('../config/db');

// const COOKIE_OPTIONS = {
//   httpOnly: true,
//   secure: process.env.NODE_ENV === 'production',
//   sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
//   maxAge: 8 * 60 * 60 * 1000 // 8 hours
// };

// // POST /api/auth/login
// exports.login = async (req, res) => {
//   try {
//     const { username, password } = req.body;
//     if (!username || !password) {
//       return res.status(400).json({ message: 'Username and password are required.' });
//     }

//     const [rows] = await pool.query('SELECT * FROM employees WHERE username = ?', [username]);
//     if (rows.length === 0) {
//       return res.status(401).json({ message: 'Invalid username or password.' });
//     }

//     const employee = rows[0];
//     const match = await bcrypt.compare(password, employee.password);
//     if (!match) {
//       return res.status(401).json({ message: 'Invalid username or password.' });
//     }

//     const payload = {
//       id: employee.id,
//       name: employee.name,
//       username: employee.username,
//       team: employee.team
//     };

//     const token = jwt.sign(payload, process.env.JWT_SECRET, {
//       expiresIn: process.env.JWT_EXPIRES_IN || '8h'
//     });

//     res.cookie('token', token, COOKIE_OPTIONS);
//     res.json({ message: 'Logged in', user: payload });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Server error during login.' });
//   }
// };

// // POST /api/auth/logout
// exports.logout = (req, res) => {
//   res.clearCookie('token', COOKIE_OPTIONS);
//   res.json({ message: 'Logged out' });
// };

// // GET /api/auth/me
// exports.me = (req, res) => {
//   res.json({ user: req.user });
// };
