# NEPTUNE - POD Processor

Scans PDFs dropped into an Input folder, reads the Code128 barcode (Sales
Shipment No, prefixed `HC-SS` or `TP-SS`), renames the file to the exact
shipment number, and files it into the right destination folder. Every run
logs a summary to SQL Server so the dashboard can show success/failure
trends per company.

## Project layout

```
ar_barcode_sorter.py     Python agent, run by Windows Task Scheduler
sql/
  05_Neptune_schema.sql  Creates the 05_Neptune database + RunLog / ControlMappings tables
backend/
  server.js              Node/Express API the dashboard talks to
  db.js                  SQL Server connection pool
dashboard/
  src/App.jsx            React dashboard (KPIs, run history, Control Mappings page)
test/                    Local test folders (Input / HC / TP / Error / Logs)
venv/                    Python virtual environment (not committed)
```

## Running locally (laptop, VS Code)

**1. Database** - run `sql/05_Neptune_schema.sql` once against your SQL
Server instance to create `05_Neptune` and seed `ControlMappings` with the
test paths.

**2. Python agent**
```
venv\Scripts\activate
python ar_barcode_sorter.py
```
Set `SQL_SERVER` near the top of `ar_barcode_sorter.py` to your instance name.
If SQL is unreachable it falls back to the hardcoded `DEFAULT_PATHS` and still
processes files - a DB outage never blocks AR document handling.

**3. Backend**
```
cd backend
npm install
copy .env.example .env      REM then fill in SQL_SERVER / SQL_USER / SQL_PASSWORD
npm run dev
```
Runs on `http://localhost:5051` by default.

**4. Dashboard**
```
cd dashboard
npm install
npm run dev
```
Opens on `http://localhost:5180`, proxies `/api/*` to the backend (see
`vite.config.js`).

## Git / deployment path

1. `git init` here once everything looks right locally, push to the team's
   remote (same pattern as Mercury Travel Billing).
2. On the server: `git clone`/`git pull` into `C:\Apps\POD`.
3. Set up the server-side Python venv (`python -m venv venv`, then
   `pip install pymupdf pyzbar pillow pyodbc`), point Task Scheduler at
   `C:\Apps\POD\venv\Scripts\python.exe C:\Apps\POD\ar_barcode_sorter.py`.
4. Build the dashboard for production (`cd dashboard && npm run build`,
   with `VITE_API_BASE` set in `.env.production` to the backend's real
   host:port), then spin up an IIS site pointed at `dashboard/dist`, and a
   second IIS site (or Node service via iisnode/PM2) for `backend/server.js`
   - same pattern used for Mercury Travel Billing's IIS deployment.
5. Run `sql/05_Neptune_schema.sql` against the production SQL Server, then
   update `ControlMappings` rows (via the dashboard's Control Mappings page,
   or directly in SQL) to point at the real `Z:\AR\...` paths.

## Notes

- `ControlMappings` lets the five folder paths be changed from the
  dashboard without redeploying the Python script.
- `RunLog` holds one row per company (`HC` / `TP` / `ERROR`) per run -
  success and failed counts - which drives every KPI on the dashboard.
- The dashboard's Control Mappings page is restricted to the AD accounts
  listed in `CONTROL_MAPPINGS_EDITORS` in `App.jsx` - this is a UI
  convenience only, not a security boundary (see Mercury's
  `docs/deployment-iis.md` note carried over into that constant's comment).
