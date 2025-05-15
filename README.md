# splice-catalog

## Setup

`cp env.example .env` - contact a member of the SPLICE team for an updated environment file if you are interested in helping with development

## Development

In order to get the development environment setup, you'll need to follow these steps:
1. Build the catalog container: `docker compose --profile catalog build`. This is likely to take a few minutes.
2. Install the node packages: `docker compose --profile catalog run catalog yarn install`. This might also take a few minutes.
3. Start the splice catalog application: `docker compose --profile
catalog up`. This will take a moment or two to get up and running
before you can open the server page in your browser. You should see a
bunch of messages with one saying something about "Server is running
on port 3000" when it is ready.

Once the container starts you'll want to do the following:

4. Running the application per step 3 will consume the current terminal, to exec into the running container, open a new terminal in the repository and run: `docker compose --profile catalog exec catalog bash` (if you are on windows, you'll need to add winpty)
5. Inside the container run: `yarn migrate` to instantiate the database

From inside this container, you can also run other yarn commands (install, add <package>, etc)

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

## Swap Branches

If you are developing the catalog, you should be checking out the staging branch `git checkout staging`

**See documentation here:** [docs](docs) 

## Production

`docker compose --profile production build`

`docker volume rm splice-catalog_staticvolume`

`docker compose --profile production up -d`
