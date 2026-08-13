require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/authRoutes');
const sellerRoutes = require('./routes/sellerRoutes');
const propertyRoutes = require('./routes/propertyRoutes');
const taskRoutes = require('./routes/taskRoutes');
const pipelineRoutes = require('./routes/pipelineRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const activityRoutes = require('./routes/activityRoutes');
const employeeRoutes = require('./routes/employeeRoutes');

const app = express();

// Trust the reverse proxy (ngrok, Railway, etc.) so req.secure reflects the protocol the
// BROWSER actually connected with (https), not the internal one Express receives the
// request over. This lets login set cookies with the right Secure/SameSite behavior
// automatically, whether the request came in over plain localhost HTTP or through a
// tunnel/host over HTTPS — see authController.js's getCookieOptions().
app.set('trust proxy', 1);

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/sellers', sellerRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/pipeline', pipelineRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/employees', employeeRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Fallback error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Unexpected server error.' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Lead2Deal API running on http://localhost:${PORT}`);
});




// require('dotenv').config();
// const express = require('express');
// const cors = require('cors');
// const cookieParser = require('cookie-parser');

// const authRoutes = require('./routes/authRoutes');
// const sellerRoutes = require('./routes/sellerRoutes');
// const propertyRoutes = require('./routes/propertyRoutes');
// const taskRoutes = require('./routes/taskRoutes');
// const pipelineRoutes = require('./routes/pipelineRoutes');
// const dashboardRoutes = require('./routes/dashboardRoutes');
// const activityRoutes = require('./routes/activityRoutes');
// const employeeRoutes = require('./routes/employeeRoutes');

// const app = express();

// app.use(cors({
//   origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
//   credentials: true
// }));
// app.use(express.json());
// app.use(cookieParser());

// app.use('/api/auth', authRoutes);
// app.use('/api/sellers', sellerRoutes);
// app.use('/api/properties', propertyRoutes);
// app.use('/api/tasks', taskRoutes);
// app.use('/api/pipeline', pipelineRoutes);
// app.use('/api/dashboard', dashboardRoutes);
// app.use('/api/activities', activityRoutes);
// app.use('/api/employees', employeeRoutes);

// app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// // Fallback error handler
// app.use((err, req, res, next) => {
//   console.error(err);
//   res.status(500).json({ message: 'Unexpected server error.' });
// });

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`Lead2Deal API running on http://localhost:${PORT}`);
// });
