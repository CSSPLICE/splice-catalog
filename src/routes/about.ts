import express from 'express';
const router = express.Router();

router.get('/', (req, res) => {
  res.render('pages/about', { title: 'About the SPLICE Catalog' });
});

export default router;
