import express from "express";
import { CatalogController } from "../controllers/CatalogController";

const catalogController = new CatalogController();

const router = express.Router();

router.get("/", catalogController.getCatalog);
router.post("/", catalogController.createSLCItem);

export default router;