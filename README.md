# splice-catalog

## Setup

`cp env.example .env` - contact a member of the SPLICE team for an updated environment file if you are interested in helping with development

## Development

To build the catalog container: `docker compose --profile catalog build`

To install the node packages: `docker compose --profile catalog run catalog yarn install`

To start the splice catalog application: `docker compose --profile catalog up`

Once the container starts you'll want to

To exec into the running container: `docker compose --profile catalog exec catalog bash` (if you are on windows, you'll need to add winpty)

And run `yarn migrate` to instantiate the database

From inside this container, you can also run other yarn commands (install, add <package>, etc)

## Import Catalog Data

Once the application is running, upload any data files to [http://localhost:3000/upload](http://localhost:3000/upload)

## Import Ontology Data

`docker compose exec splice-catalog-catalog-1 yarn import:ontology`

## Interact with database

To access the database from the command line: 
```
docker compose --profile catalog exec db bash
mysql -usplice -psplice
use splice;
```

**See documentation here:** [docs](docs) 

## Production

`docker compose --profile production build`

`docker compose --profile production up -d`
