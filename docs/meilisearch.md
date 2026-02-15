## Search Configuration (Meilisearch)

This project uses Meilisearch for high-performance, fuzzy full-text search.

### 1. Setup Environment

In your .env file, ensure you have defined the following variables:
MEILI_MASTER_KEY=masterKey123
MEILISEARCH_HOST=http://meilisearch:7700

---

### 2: Automated Search Syncs

The search engine is automatically kept in sync with the MySQL database.

Automatic Indexing: TypeORM lifecycle hooks are configured on the catalog entity. Any insertion, update, or deletion in the database (via OpenDSA, CodeCheck, or UI imports) is automatically reflected in Meilisearch in real-time.

Database as Source of Truth: The system indexes the live state of the database, removing any dependency on static JSON files.

### 3: Search Initialization & Aliases

To initialize the search settings (ranking rules) and sync synonyms (e.g., "BST" <-> "Binary Search Tree")

Sync Settings & Aliases: docker compose exec catalog yarn search:seed(Note: This command now initializes index settings and pulls aliases from the search_aliases table without requiring a local JSON file.)

Managing Search Aliases
View Aliases: docker compose exec db mysql -u splice -psplice splice -e "SELECT \* FROM search_aliases;"

Add Alias: docker compose exec db mysql -u splice -psplice splice -e "INSERT INTO search_aliases (term, synonym) VALUES ('LL', 'Linked List');"
