# Controllers

An overview of the controllers implemented in the splice-catalog. They are responsible for handling operations related to the Smart Learning Catalog (SLC) and its content

---

## **[CatalogController](../src/controllers/CatalogController.ts)**

The `CatalogController` manages operations related to the catalog, including retrieving, creating, and deleting catalog items.

- Retrieve catalog items from the database.
- Validate input data before saving to the database.

---

## **[ViewController](../src/controllers/ViewController.ts)**

The `ViewController` is responsible for rendering views and managing the display of various pages in the system.

- Render the catalog page with pagination for catalog items, specific catalog item and other pages (instructions and upload).
- Manage file uploads, validate data, and initiate the review process and create new catalog items based on its type (`SLCItemCatalog`, `DatasetCatalog`, `ToolsCatalog`).
- Handles categorization workflows
- Statistical data (counts of tools, items, and datasets) on the home page.

---

## **[ReviewController](../src/controllers/ReviewController.ts)**

The `ReviewController` manages the validation and review process for uploaded catalog data, called from the View Controller during uploads/contributions. it calls the services to:

- Validate metadata for uploaded items.
- check URLs for validity and accessibility during the validation process.
- Categorize validated items by matching them to the ontology.
- Render the review dashboard with validation results, including issues and categorization outcomes.

---

## **[SearchController](../src/controllers/SearchController.ts)**

The `SearchController` provides functionality for searching catalog items based on user queries.

- Retrieve catalog items that match query parameters across multiple fields

---

## **[ToolsCatalogController](../src/controllers/ToolsCatalogController.ts)**

The `ToolsCatalogController` handles operations related to the tools catalog.

- Retrieve all tools catalog data from the database.
- Validate and create new tools catalog items.
