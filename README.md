# splice-catalog

## Setup

`cp env.example .env`

## Development

To build the catalog container: `docker compose --profile catalog build`

To run the splice catalog application: `docker compose --profile catalog up`

Once the container starts you'll want to

To exec into the running container: `docker compose --profile catalog exec catalog bash`

And run `yarn migrate` to instantiate the database

From inside this container, you can also run other yarn commands (install, add <package>, etc)

## Import Ontology Data

`docker compose exec splice-catalog-catalog-1 yarn import:ontology`

**See documentation here:** [docs](docs) 

## Production

`docker compose --profile production build`

`docker compose --profile production up -d`


