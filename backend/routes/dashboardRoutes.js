const router = require('express').Router();
const requireAuth = require('../middleware/auth');
const { getDashboardStats } = require('../controllers/dashboardController');

router.use(requireAuth);
router.get('/', getDashboardStats);

module.exports = router;
