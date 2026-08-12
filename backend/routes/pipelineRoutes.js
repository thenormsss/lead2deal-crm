const router = require('express').Router();
const requireAuth = require('../middleware/auth');
const { getPipeline } = require('../controllers/pipelineController');

router.use(requireAuth);
router.get('/', getPipeline);
// No PUT route: pipeline stage is read-only here, driven entirely by task completion.

module.exports = router;