import "dotenv/config";
import express from "express";
import cors from "cors";
import { getPool, sql } from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5051;

// --- /api/me ----------------------------------------------------------------
// Same static-user pattern as Mercury in local dev: no real per-request
// identity here (that comes from IIS + Windows Auth in production - see
// web.config's outbound rule). Locally this just reflects whoever's running
// the backend process.
app.get("/api/me", (req, res) => {
  res.json({ user: process.env.USERNAME || process.env.USER || "dev-user" });
});

// --- /api/dashboard/summary ---------------------------------------------------
// period is "today", "all", or "YYYY-MM". Aggregates dbo.RunLog into the
// KPI shape App.jsx's Dashboard component expects.
app.get("/api/dashboard/summary", async (req, res) => {
  const period = req.query.period || "today";
  try {
    const pool = await getPool();
    const request = pool.request();

    let dateFilter = "1=1";
    if (period === "today") {
      dateFilter = "CAST(RunTimestamp AS DATE) = CAST(SYSDATETIME() AS DATE)";
    } else if (period !== "all") {
      // Expect "YYYY-MM"
      const [year, month] = period.split("-").map(Number);
      if (year && month) {
        request.input("year", sql.Int, year);
        request.input("month", sql.Int, month);
        dateFilter = "YEAR(RunTimestamp) = @year AND MONTH(RunTimestamp) = @month";
      }
    }

    const result = await request.query(`
      SELECT Company, SUM(SuccessCount) AS Success, SUM(FailedCount) AS Failed
      FROM dbo.RunLog
      WHERE ${dateFilter}
      GROUP BY Company
    `);

    const lastRunResult = await pool.request().query(
      "SELECT MAX(RunTimestamp) AS LastRunAt FROM dbo.RunLog"
    );

    let success = 0, failed = 0, hcSuccess = 0, hcFailed = 0, tpSuccess = 0, tpFailed = 0;
    for (const row of result.recordset) {
      success += row.Success || 0;
      failed += row.Failed || 0;
      if (row.Company === "HC") { hcSuccess = row.Success || 0; hcFailed = row.Failed || 0; }
      if (row.Company === "TP") { tpSuccess = row.Success || 0; tpFailed = row.Failed || 0; }
    }

    res.json({
      processed: success + failed,
      success,
      failed,
      hcSuccess, hcFailed,
      tpSuccess, tpFailed,
      lastRunAt: lastRunResult.recordset[0]?.LastRunAt ?? null,
    });
  } catch (err) {
    console.error("GET /api/dashboard/summary failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- /api/runs ----------------------------------------------------------------
// Most recent run log rows, newest first, for the "Run History" table.
app.get("/api/runs", async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT TOP 200 Id, RunTimestamp, Company, SuccessCount, FailedCount
      FROM dbo.RunLog
      ORDER BY RunTimestamp DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("GET /api/runs failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- /api/control-mappings ---------------------------------------------------
app.get("/api/control-mappings", async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT Id, MappingKey, MappingValue, Description, ModifiedAt, ModifiedBy
      FROM dbo.ControlMappings
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("GET /api/control-mappings failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/control-mappings/:id", async (req, res) => {
  const { id } = req.params;
  const { mappingValue, modifiedBy } = req.body;

  if (!mappingValue || !mappingValue.trim()) {
    return res.status(400).json({ error: "mappingValue is required" });
  }

  try {
    const pool = await getPool();
    await pool.request()
      .input("id", sql.Int, id)
      .input("value", sql.NVarChar(500), mappingValue)
      .input("modifiedBy", sql.VarChar(100), modifiedBy || null)
      .query(`
        UPDATE dbo.ControlMappings
        SET MappingValue = @value, ModifiedAt = SYSDATETIME(), ModifiedBy = @modifiedBy
        WHERE Id = @id
      `);
    res.json({ ok: true });
  } catch (err) {
    console.error(`PUT /api/control-mappings/${id} failed:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Neptune backend listening on http://localhost:${PORT}`);
});
