// routes/ontology.ts

import express from 'express';
import { OntologyController } from '../controllers/OntologyController';

const router = express.Router();
const ontologyController = new OntologyController();

router.get('/tiles', ontologyController.viewOntologyTiles.bind(ontologyController));
router.get('/tiles-data', ontologyController.getOntologyTilesData.bind(ontologyController));
router.get('/tiles-data/:parentId', ontologyController.getChildCategories.bind(ontologyController));
router.get('/tree', ontologyController.getOntologyTree.bind(ontologyController));

export default router;
