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

---

## **[OntologyController](../src/controllers/OntologyController.ts)**

The `OntologyController` manages operations related to the ontology, it is used for navigating and retrieving the keywords and parent-child relationships in the ontology. It includes the following methods:

1. **`getOntologyTilesData`**

   - Fetches top-level ontology categories (parent categories) or child categories based on the provided `parentId`.
   - Includes breadcrumb data to reflect the navigation path.

2. **`getChildCategories`**

   - Fetches child categories for a specific parent category.
   - Returns breadcrumb data to help navigate the hierarchy.

3. **`getOntologyTree`**

   - Fetches the entire ontology structure as a parent-child tree and can be called for other operations like filtering and CRUD operations. you can access the raw data with the hierachy from here http://localhost:3000/ontology/tree/

4. **Private Methods:**
   - **`fetchCategoriesAndBreadcrumb`**
     - A helper method to fetch categories (top-level or child) and their breadcrumb paths based on the `parentId`.
   - **`buildBreadcrumb`**
     - Constructs breadcrumb paths from the current category up to the root.

---

**The ontology tiles page works with a JavaScript file:** [ontologyTiles.js](../src/public/js/ontologyTiles.js)

The `ontologyTiles.js` script manages the client-side behavior for navigating ontology tiles and breadcrumbs. It does the following:

1. **Load Categories:**

   - Fetches top-level categories or child categories via AJAX requests.
   - Calls the `getOntologyTilesData` endpoint for initial loading or navigation.

2. **Render Tiles:**

   - Displays the retrieved ontology categories as clickable tiles.

3. **Breadcrumb Navigation:**

   - Builds breadcrumbs to show the current navigation path.
   - Breadcrumb links allow users to navigate back to any level of the hierarchy.

4. **Event Handling:**
   - Handles tile clicks to load child categories.
   - Supports breadcrumb navigation for moving up and down the tree/graph.
