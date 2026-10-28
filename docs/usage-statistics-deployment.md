# Usage Statistics dashboard and historical import

The production team should use its existing deployment and migration process. Before importing, apply `1791914000000-CreateHistoricalUsageTable` so `historical_usage` exists, and confirm database readiness, backup/recovery arrangements, and the approved target. Production startup does not automatically run migrations.

## Optional historical Nginx import

Importing requires separate approval. Obtain the approved `historical-usage-import.json` through private storage or a secure transfer channel; keep it out of Git, public uploads, and container images. Do not use an older checkout's import or transfer raw Nginx logs. The approved file contains **3,729 entries / 23,202 page requests**, after bot filtering and the 63-distinct-entry cutoff.

Expected SHA-256:

```text
dac88df66f3009387186cab767bd487425e65fcc2005025ddb72d8cac1651d20
```

On the approved deployment host, check the privately received file:

```sh
sha256sum /approved/path/historical-usage-import.json
```

On macOS, use `shasum -a 256` instead. **Stop if the digest differs.** The commands below use this repository's `production` Compose profile, running `prod` service, and application directory; have the production team confirm its project/overrides and adapt these references as needed.

Copy only the approved JSON into the existing application container, then verify the copied bytes:

```sh
docker compose --profile production cp /approved/path/historical-usage-import.json prod:/home/deploy/app/historical-usage-import.json
docker compose --profile production exec -T prod sha256sum /home/deploy/app/historical-usage-import.json
```

Proceed only when the container checksum also matches. Run the read-only preview:

```sh
docker compose --profile production exec prod yarn usage:seed-history:prod historical-usage-import.json --dry-run
```

Successful validation reports **3,729 entries, 23,202 page requests, and no missing entries or persistent-ID mismatches**. Stop on any validation failure or stale-row conflict. Independently confirm the printed `host:port/database`; imported numeric IDs must not be assumed to match another catalog.

After explicit approval to write, replace `HOST:PORT/DATABASE` with that exact confirmed target (no credentials):

```sh
docker compose --profile production exec prod yarn usage:seed-history:prod historical-usage-import.json --confirm-target=HOST:PORT/DATABASE --approve-production
```

After success, repeat only the dry run: expect 3,729 unchanged rows, zero inserts/updates, and 23,202 requests.

## Dashboard smoke test

- Confirm `/admin/usage-statistics`, historical data, and exports require an admin; anonymous/non-admin requests receive 401/403.
- Check all five KPI cards and both charts. Coordinate deliberate entry/external clicks and WEB/API searches; these tests create live events. Empty API listings must not count as searches.
- Open **Historical Nginx Data**: verify totals, search, and pagination. Historical statistics remain all-time aggregates, not confirmed human clicks; live date filters must not change them or mix them into live KPI totals. Catalog links require matching persistent identities.
- Check live JSON/CSV against live filters. Separate historical JSON/CSV must contain all 3,729 entries / 23,202 requests, independent of table search, pagination, and live filters.
