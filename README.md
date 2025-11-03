# splice-catalog

## Setup

`cp env.example .env` - contact a member of the SPLICE team for an updated environment file if you are interested in helping with development

## Development

In order to get the development environment setup, you'll need to follow these steps:
1. Build the catalog container: `docker compose --profile catalog build`. [Depending on your internet connection, this might take a long time.]
2. [If this is a fresh install:] cp env.example .env
3. Install the node packages: `docker compose --profile catalog run catalog yarn install`
4. Start the splice catalog application: `docker compose --profile catalog up`

5. Running the application per step 3 will consume the current terminal. To exec into the running container, open a new terminal in the repository and run: `docker compose --profile catalog exec catalog bash` (if you are on windows, you'll need to add winpty)

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

If you end up needing to clear the database and start over, you can run `docker compose --profile catalog down --remove-orphans -v to remove the volumes. You should accompny this with a `build` and an `up` to reset everything

## Swap Branches

If you are developing the catalog, you should be checking out the staging branch `git checkout staging`

**See documentation here:** [docs](docs)

## Production

`docker compose --profile production build`

`docker volume rm splice-catalog_staticvolume`

`docker compose --profile production up -d`
