const router = require('express').Router();
const requireAuth = require('../middleware/auth');
const { getAllSellers, createSeller, updateSeller } = require('../controllers/sellerController');

router.use(requireAuth);
router.get('/', getAllSellers);
router.post('/', createSeller);
router.put('/:id', updateSeller);

module.exports = router;
