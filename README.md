# splice-catalog

## Setup

`cp env.example .env`

## Development

To build the catalog container: `docker compose --profile catalog build`

To run the splice catalog application: `docker compose --profile catalog up`

To exec into the running container: `docker compose --profile catalog exec catalog bash`

This is where you can do things like running yarn commands (yarn install, yarn add <package>, etc) from within the docker container

## Import Ontology Data

`docker compose exec splice-catalog-catalog-1 yarn import:ontology`

**See documentation here:** [docs](docs) 

## Production

`docker compose --profile production build`

`docker compose --profile production up -d`


