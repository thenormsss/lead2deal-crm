const router = require('express').Router();
const requireAuth = require('../middleware/auth');
const { getAllEmployees } = require('../controllers/employeeController');

router.use(requireAuth);
router.get('/', getAllEmployees);

module.exports = router;
