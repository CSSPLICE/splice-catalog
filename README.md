# splice-catalog

## Setup

`cp env.example .env`

## Development

`docker compose --profile catalog build`
`docker compose --profile catalog up`

## Import Ontology Data

`docker compose exec splice-catalog-catalog-1 yarn import:ontology`


## Production

`docker compose --profile production build`
`docker compose --profile production up -d`


