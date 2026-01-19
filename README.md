# splice-catalog

## Setup

`cp env.example .env` - contact a member of the SPLICE team for an updated environment file if you are interested in helping with development

## Search Configuration (Meilisearch)

This project uses Meilisearch for high-performance, fuzzy full-text search.

### 1. Setup Environment
In your .env file, ensure you have defined the following variables:
MEILI_MASTER_KEY=masterKey123
MEILISEARCH_HOST=http://meilisearch:7700
---

### 2: Search Scripts
The following scripts are available via yarn to manage the search index:
"yarn search:seed" - Clears the DB, seeds 782 items from data/slc.json, and initializes the Search index.
"yarn search:sync" - Pushes current MySQL database records into the Meilisearch index.

### 3: Search Alias (Synonym) System
To bridge the gap between technical shorthand and full academic terms (e.g., "BST" vs. "Binary Search Tree"), the catalog uses a Symmetric Alias Mapping system.

## How it Works
The system uses a dedicated MySQL table (search_aliases) to store relationships. When the search index is seeded, these are pushed to Meilisearch as synonyms. This allows for:

Acronym Support: Searching "BST" will return items that only contain "Binary Search Tree."

Bi-directional matching: Searching the full term will also return items that use the shorthand.

## Managing Aliases
View Aliases: docker compose exec db mysql -u splice -psplice splice -e "SELECT * FROM search_aliases;

Add Alias: docker compose exec db mysql -u splice -psplice splice -e "INSERT INTO search_aliases (term, synonym) VALUES ('Sorting', 'Ordering');"

Sync Changes: After modifying the table, run docker compose exec catalog yarn search:seed to push changes to the search engine.

## Development
In order to get the development environment setup, you'll need to follow these steps:
1. Build the catalog container and start: `docker compose --profile catalog up --build -V`. [Depending on your internet connection, this might take a long time.] [The -V flag is critical if dependencies (like meilisearch) have changed, as it refreshes anonymous Docker volumes.]
2. [If this is a fresh install:] cp env.example .env
3. Install the node packages: `docker compose --profile catalog run catalog yarn install`
4. Seed Data (Massive Seed): To populate the database and search index with the full 780+ records, run: `docker compose --profile catalog exec catalog yarn search:seed`
   
5. Start the splice catalog application: `docker compose --profile catalog up`
6. Running the application per step 3 will consume the current terminal. To exec into the running container, open a new terminal in the repository and run: `docker compose --profile catalog exec catalog bash` (if you are on windows, you'll need to add winpty)

From inside this container, you can also run yarn commands (migrate, install, add <package>, etc)

6. At this point, the catalog will be running at [http://localhost:3000/](http://localhost:3000/)

## Import Catalog Data

Once the application is running, upload any data files to [http://localhost:3000/upload](http://localhost:3000/upload)

## Import Ontology Data

`docker compose --profile catalog exec yarn import:ontology`

## Interact with database

To access the database from the command line:
```
docker compose --profile catalog exec db bash
mysql -usplice -psplice
use splice;
```

## Clear Database

If you end up needing to clear the database and start over, you can run `docker compose --profile catalog down --remove-orphans -v` to remove the volumes. You should accompny this with a `build` and an `up` to reset everything

## Swap Branches

If you are developing the catalog, you should be checking out the staging branch `git checkout staging`

**See documentation here:** [docs](docs)

## Production

`docker compose --profile production build`

`docker volume rm splice-catalog_staticvolume`

`docker compose --profile production up -d`
