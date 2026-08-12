const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).json({ message: 'Not authenticated. Please log in.' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, name, username, team }
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Session expired. Please log in again.' });
  }
}

module.exports = requireAuth;
