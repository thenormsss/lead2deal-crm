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
