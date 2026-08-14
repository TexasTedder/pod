/*
    05_Neptune - Database schema
    ----------------------------
    Supports the NEPTUNE POD Processor (ar_barcode_sorter.py) and its
    dashboard. Two tables:

      dbo.RunLog          - one row per company per run, logged after each
                             Task Scheduler execution. Feeds the dashboard's
                             KPI cards (Date, Company, Success, Failed).

      dbo.ControlMappings - the five folder paths the script currently has
                             hardcoded (INPUT_DIR, HC_DIR, TP_DIR, ERROR_DIR,
                             LOG_DIR). The script reads these at startup
                             instead of using constants, and the dashboard's
                             Control Mappings page lets HC edit them without
                             touching code or redeploying.

    Run this once against your SQL Server instance to create the database
    and tables. Adjust file paths / sizing below if your server has a
    non-default data/log directory convention.
*/

IF DB_ID('05_Neptune') IS NULL
BEGIN
    CREATE DATABASE [05_Neptune];
END
GO

USE [05_Neptune];
GO

-- ---------------------------------------------------------------------------
-- dbo.RunLog
-- ---------------------------------------------------------------------------
-- One row per company (HC / TP) per script run. If a run processes zero
-- files for a company, no row is written for that company that run - the
-- dashboard treats "no row" the same as "0 processed" for that period.
IF OBJECT_ID('dbo.RunLog', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.RunLog (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        RunTimestamp    DATETIME2(0)  NOT NULL DEFAULT SYSDATETIME(),
        Company         VARCHAR(10)   NOT NULL,   -- 'HC', 'TP', or 'ERROR'
        SuccessCount    INT           NOT NULL DEFAULT 0,
        FailedCount     INT           NOT NULL DEFAULT 0,
        CreatedAt       DATETIME2(0)  NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_RunLog_RunTimestamp ON dbo.RunLog (RunTimestamp DESC);
    CREATE INDEX IX_RunLog_Company      ON dbo.RunLog (Company);
END
GO

-- ---------------------------------------------------------------------------
-- dbo.ControlMappings
-- ---------------------------------------------------------------------------
-- Simple key/value store for the folder paths. MappingKey matches the
-- constant name in ar_barcode_sorter.py (INPUT_DIR, HC_DIR, TP_DIR,
-- ERROR_DIR, LOG_DIR) so the script can look each one up directly.
IF OBJECT_ID('dbo.ControlMappings', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ControlMappings (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        MappingKey      VARCHAR(50)   NOT NULL UNIQUE,
        MappingValue    NVARCHAR(500) NOT NULL,
        Description     NVARCHAR(200) NULL,
        ModifiedAt      DATETIME2(0)  NOT NULL DEFAULT SYSDATETIME(),
        ModifiedBy      VARCHAR(100)  NULL
    );
END
GO

-- Seed with the current test paths. Update these to the real Z:\AR\...
-- paths (or UNC equivalents) before pointing the script at production.
MERGE dbo.ControlMappings AS target
USING (VALUES
    ('INPUT_DIR', 'C:\Projects\POD\test\Input',        'Folder scanned for incoming PDFs'),
    ('HC_DIR',    'C:\Projects\POD\test\HC\Unprocessed','Destination for HC-SS shipment PDFs'),
    ('TP_DIR',    'C:\Projects\POD\test\TP\Unprocessed','Destination for TP-SS shipment PDFs'),
    ('ERROR_DIR', 'C:\Projects\POD\test\Error',         'Destination for unreadable/unmatched PDFs'),
    ('LOG_DIR',   'C:\Projects\POD\test\Logs',           'Folder for the script''s log files')
) AS source (MappingKey, MappingValue, Description)
ON target.MappingKey = source.MappingKey
WHEN NOT MATCHED THEN
    INSERT (MappingKey, MappingValue, Description)
    VALUES (source.MappingKey, source.MappingValue, source.Description);
GO
