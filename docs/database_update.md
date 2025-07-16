# Database Update

To add a new table to the databse, you'll need to add information to several different files in several different locations. We use [TypeORM](https://typeorm.io/) for our DB, their documentation is pretty good for what you can do with the DB.

1. Create a new Entity file in src/db/entities
2. Create a new DTO in src/dtos for your new Entity. This DTO is basically a validator to ensure the format of the submitted file matches the expected database schema.
3. Once you've created the new database object, you can run a migration to build it into the DB. package.json has the instructions for this (you'll need to run something like yarn migrate:create) from within the catalog container.
4. After you've generated the migration you'll need to import the migration, then add it to the list in src/db/data-source.ts
5. Then you can return to the catalog container and run yarn migrate to apply the migration and check if it applied correctly by accessing the database.

## Database Access

During development, it is convenient to connect to the `splice` database from your host machine using [DataGrip]((https://www.jetbrains.com/datagrip/). You should have access to this via the GitHub student developer pack (and this database viewer is included in all their IDEs). Once you installed and IDE with the database viewer, you can create a new connection to Docker Database using the following setup:

- Connection Name: SPLICE-Catalog
- Connection Method: Standard TCP/IP
- MySQL Hostname: 127.0.0.1
- MySQL Server Port: 3306
- Username: splice
- Password: splice
