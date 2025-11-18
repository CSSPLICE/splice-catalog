import { Router } from "express";
import { AppDataSource } from "../db/data-source.js";

const router = Router();

/**
 * GET /api/export
 * Optional: ?type=item|tool|dataset
 * Returns only re-uploadable JSON (no meta wrapper).
 */
router.get("/export", async (req, res, next) => {
  try {
    const { type } = req.query as { type?: "item" | "tool" | "dataset" };

    // SELECT only the columns you'd want to re-upload (omit DB ids/timestamps).
    const itemSql = `
      SELECT catalog_type, persistentID, platform_name, iframe_url, license,
             description, author, institution, keywords, features, title,
             programming_language, natural_language, protocol, protocol_url
      FROM slc_item_catalog
    `;

    const toolSql = `
      SELECT catalog_type, platform_name, url, description, license,
             interface, contact_email, lti_credentials
      FROM slc_tools_catalog
    `;

    const datasetSql = `
      SELECT *
      FROM dataset_catalog
    `;

    const conn = AppDataSource;

    if (type === "item") {
      const items = await conn.query(itemSql);
      return res.json(items);                     // plain array, no meta
    }
    if (type === "tool") {
      const tools = await conn.query(toolSql);
      return res.json(tools);
    }
    if (type === "dataset") {
      const datasets = await conn.query(datasetSql);
      return res.json(datasets);
    }

    const [items, tools, datasets] = await Promise.all([
      conn.query(itemSql),
      conn.query(toolSql),
      conn.query(datasetSql),
    ]);

    return res.json({
      slc_item_catalog: items,
      slc_tools_catalog: tools,
      dataset_catalog: datasets,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
