Usage Statistics — Deployment Quick Guide
Confirm the actual production host/Compose overrides, database, backup and recovery plan before running commands. The repository instructions do not prove the server uses this exact workflow. Production startup does not run migrations.

1. Check locally
npm run test:usage
npm run build
npm run gulp
2. Deploy (approved maintenance window)

docker compose --profile production build
docker compose --profile production down  # never add -v
docker compose --profile production up -d --wait --wait-timeout 120 db
Before TypeORM: in an approved MySQL session connected to the confirmed production database, check readiness and the existing migration ledger:

SELECT 1; SELECT DATABASE(); SHOW TABLES LIKE 'migrations';
SELECT id, timestamp, name FROM migrations ORDER BY id;
Stop if the DB is wrong, not ready, or the ledger is missing. Then inspect all pending migrations:
docker compose --profile production run --rm --no-deps --entrypoint sh prod -c 'yarn typeorm:prod migration:show'

Only if migrations are pending, reviewed, backed up, and separately approved:
docker compose --profile production run --rm --no-deps --entrypoint sh prod -c 'yarn typeorm:prod 

migration:run'
Start the app and verify service health:
docker compose --profile production up -d
docker compose --profile production ps

3. Smoke test
As an admin, open /admin/usage-statistics. Test entry/external clicks, deliberate WEB searches, nonempty GET /api/items?terms=trees, filters, and JSON/CSV exports. Plain GET /api/items must not count as a search.

The Historical Nginx Data tab loads six entries per request from the admin-only /admin/usage-statistics/historical endpoint (page and q parameters). Its database totals and rows are all-time SLC aggregates, independent of live date/catalog filters. Catalog links require an exact persistent-ID match to a current catalog entry. The separate /admin/usage-statistics/historical/export and .csv exports include the full historical entry list and summary, independent of table search/pagination. Live JSON/CSV contracts and KPI totals are unchanged.

4. Historical import (optional; separate approval)
Obtain the private approved historical-usage-import.json, not the older tracked copy. Approved contents: 3,729 entries / 23,202 requests, cutoff ≥63 distinct entries per client identity. Expected SHA-256:
dac88df66f3009387186cab767bd487425e65fcc2005025ddb72d8cac1651d20

Verify the received file's SHA-256, copy it only to the approved container, verify the checksum again inside it, then run the dry run:

docker compose --profile production cp /approved/path/historical-usage-import.json prod:/home/deploy/app/historical-usage-import.json
docker compose --profile production exec prod yarn usage:seed-history:prod historical-usage-import.json --dry-run

Confirm the printed host:port/database, persistent-ID matches and expected totals. Only after separate authorization to write:

read -r USAGE_SEED_TARGET
docker compose --profile production exec prod yarn usage:seed-history:prod historical-usage-import.

json "--confirm-target=$USAGE_SEED_TARGET" --approve-production

unset USAGE_SEED_TARGET

Verify historical_usage: COUNT(*) = 3729 and SUM(viewCount) = 23202. Repeat the dry run only to confirm no changes. Historical requests never contribute to live clicks.

Known release checks: Node 21 is end-of-life; confirm a supported-runtime plan and production image smoke test. Check static asset volume refresh (new CSS/JS can be masked). Never delete volumes, upload raw logs, or commit secrets/import artifacts.