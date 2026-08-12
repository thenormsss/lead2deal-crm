const router = require('express').Router();
const requireAuth = require('../middleware/auth');
const { getAllActivities } = require('../controllers/activityController');

router.use(requireAuth);
router.get('/', getAllActivities);

module.exports = router;
