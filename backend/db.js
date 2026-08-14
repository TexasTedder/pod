import sql from "mssql";
import "dotenv/config";

// Single shared connection pool for the whole backend - mssql handles
// pooling/reconnection internally, so every route just calls getPool()
// and runs its query.
const config = {
  server: process.env.SQL_SERVER,
  database: process.env.SQL_DATABASE || "05_Neptune",
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  options: {
    encrypt: false,          // set true if your SQL Server requires TLS
    trustServerCertificate: true,
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

let poolPromise;

export function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(config).catch(err => {
      poolPromise = null; // allow retry on next call instead of staying broken
      throw err;
    });
  }
  return poolPromise;
}

export { sql };
