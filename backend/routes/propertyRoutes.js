const router = require('express').Router();
const requireAuth = require('../middleware/auth');
const {
  getAllProperties, createProperty, updateProperty, getSellersForDropdown
} = require('../controllers/propertyController');

router.use(requireAuth);
router.get('/', getAllProperties);
router.get('/sellers-dropdown', getSellersForDropdown);
router.post('/', createProperty);
router.put('/:id', updateProperty);

module.exports = router;
