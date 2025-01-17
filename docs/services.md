# Services

The catalog is designed with modular services to handle specific functionalities related to the classification, extraction, validation, and reporting of content.

[Services](src/services) Summary:

- Categorizer: Classification of content.
- KeywordMatch: Matching metadata to ontology.
- MetadataExtractor: Extracting keywords from uploaded items.
- CategoryReport: Generating reports.
- ValidationManager: Manages validation.

---

## Services 

### 1. **[Categorizer](src/services/Categorizer.ts)** 

The `Categorizer` is responsible for classifying content items into ontology classes based on their metadata. It utilizes keyword matching and ontology lookups to determine the appropriate classification.

- Matches content metadata to ontology classes.
- Handles "Unclassified" items by assigning them to a default category.
- Updates the `ItemClassification` table with classification results.

---

### 2. **[KeywordMatch](src/services/KeywordMatch.ts)**

The `KeywordMatch` service is responsible for mapping metadata keywords to ontology classes. It uses a predefined set of keywords from the ontology for matching.

- Performs keyword matching.

---

### 3. **[MetadataExtractor](src/services/MetadataExtractor.ts)**

The `MetadataExtractor` service extracts `keywords` from the uploaded content items.


---

### 4. **[MetadataValidator](src/services/MetadataValidator.ts)**

The `MetadataValidator` service is responsible for ensuring that the metadata of items in the catalog meets predefined standards and requirements. It checks fields such as `title`, `description`, `keywords`, and `author` for completeness and consistency.


---

### 5. **[URLValidator](src/services/URLValidator.ts)**

The `URLValidator` service ensures that URLs provided in the catalog, such as content URLs and iframe URLs, are valid and reachable, uses Axios library for the HTTP requests

- Validate URL format using regular expressions.
- Check the availability and accessibility of URLs via HTTP requests.
- Report invalid or unreachable URLs for further review


---

### 6. **[CategoryReport](src/services/CategoryReport.ts)**

The `CategoryReport` service generates detailed reports on the classification and distribution of content within the ontology.


---

### 7. **[ValidationManager](src/services/ValidationManager.ts)**

The `ValidationManager` service acts as a central manager for coordinating and executing various validation checks / services. It integrates the `Categorizer` `MetadataValidator`, `URLValidator`, `CategoryReport` and others.