import express from 'express';
import { SearchController } from '../controllers/SearchController.js';

const router = express.Router();
const searchController = new SearchController();

router.get('/', searchController.searchCatalog);
router.post('/', searchController.searchCatalog);

router.get('/export', async (req, res) => {
  try {
    const items = await searchController.searchCatalogRaw(
      req.query.query,
      req.query.features
    );

    res.setHeader(
      'Content-Disposition',
      'attachment; filename="results.json"'
    );
    res.setHeader('Content-Type', 'application/json');

    return res.send(JSON.stringify(items, null, 2));
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).send('Export failed');
  }
});

export default router;
