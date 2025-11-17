-- ClickHouse Schema for KPI Rebalancing Engine
-- Stores KPI configuration, data, and audit logs in separate tables

CREATE DATABASE IF NOT EXISTS kpi_engine;

USE kpi_engine;

-- ==============================================================================
-- KPI Configuration Table
-- Stores the dynamic KPI templates (formulas, dependencies, lock strategies)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS kpi_config (
    kpi_name String,                    -- KPI identifier (e.g., "Sls U", "COGS")
    display_name String,                -- Human-readable name
    is_editable UInt8,                  -- 1 = editable, 0 = calculated
    formula Nullable(String),           -- Mathematical formula (e.g., "Sls U * AUC")
    description Nullable(String),       -- Help text

    -- Dependencies stored as JSON array
    depends_on String DEFAULT '[]',     -- JSON array of KPI names this depends on
    locks_when_edited String DEFAULT '[]', -- JSON array of KPIs to lock when editing

    -- Multi-week effects stored as JSON array
    affects_weeks String DEFAULT '[]',  -- JSON array: [{"offset": 4, "targetKPI": "Return Inv"}]

    -- Metadata
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now(),
    version UInt32 DEFAULT 1            -- For config versioning
)
ENGINE = ReplacingMergeTree(version)   -- Automatically keeps latest version
ORDER BY (kpi_name)
SETTINGS index_granularity = 8192;

-- ==============================================================================
-- Main KPI Data Table
-- Stores actual KPI values per product per week
-- ==============================================================================

CREATE TABLE IF NOT EXISTS kpi_data (
    -- Primary identifiers
    product_id String,
    product_name String,
    week UInt8,
    year UInt16,

    -- Sales KPIs
    sls_u Float64 DEFAULT 0,          -- Sales Units
    sls_dollars Float64 DEFAULT 0,    -- Sales Dollars
    aur Float64 DEFAULT 0,            -- Average Unit Retail
    auc Float64 DEFAULT 0,            -- Average Unit Cost
    dr_percent Float64 DEFAULT 0,     -- Discount Rate %

    -- Return KPIs
    return_percent Float64 DEFAULT 0, -- Return %
    return_u Float64 DEFAULT 0,       -- Return Units
    return_dollars Float64 DEFAULT 0, -- Return Dollars

    -- Margin KPIs
    cogs Float64 DEFAULT 0,           -- Cost of Goods Sold
    gm_dollars Float64 DEFAULT 0,     -- Gross Margin $
    gm_percent Float64 DEFAULT 0,     -- Gross Margin %

    -- Net Sales KPIs
    net_sls_u Float64 DEFAULT 0,      -- Net Sales Units
    net_sls_dollars Float64 DEFAULT 0,-- Net Sales $

    -- Inventory KPIs
    bop_u Float64 DEFAULT 0,          -- Beginning of Period Units
    bop_dollars Float64 DEFAULT 0,    -- Beginning of Period $
    eop_u Float64 DEFAULT 0,          -- End of Period Units
    eop_dollars Float64 DEFAULT 0,    -- End of Period $
    total_rcpt_u Float64 DEFAULT 0,   -- Total Receipts Units
    total_rcpt_dollars Float64 DEFAULT 0, -- Total Receipts $
    return_inv Float64 DEFAULT 0,     -- Return Inventory

    -- Planning KPIs
    fwos Float64 DEFAULT 0,           -- Forward Weeks of Supply
    rec_rcpt_u Float64 DEFAULT 0,     -- Recommended Receipts Units
    rec_rcpt_dollars Float64 DEFAULT 0, -- Recommended Receipts $

    -- Metadata
    last_edited_kpi Nullable(String), -- Last KPI that was edited
    last_edited_timestamp Nullable(DateTime), -- When it was last edited
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
ORDER BY (product_id, year, week)
PARTITION BY (product_id, year)
SETTINGS index_granularity = 8192;

-- Index for efficient querying by product and time range
CREATE INDEX IF NOT EXISTS idx_product_week ON kpi_data (product_id, year, week) TYPE minmax GRANULARITY 1;

-- ==============================================================================
-- Audit Log Table
-- Tracks all changes (user edits and system recalculations)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS kpi_audit_log (
    id UUID DEFAULT generateUUIDv4(),
    timestamp DateTime DEFAULT now(),
    log_type Enum8('user-edit' = 1, 'system-recalc' = 2),
    product_id String,
    week UInt8,
    year UInt16,
    kpi_name String,
    old_value Float64,
    new_value Float64,
    triggered_by Nullable(String),      -- For system recalcs: which KPI triggered this
    calculation_level Nullable(UInt8),  -- For system recalcs: dependency level
    formula Nullable(String),           -- For system recalcs: formula used
    user_id Nullable(String)            -- For future user tracking
)
ENGINE = MergeTree()
ORDER BY (product_id, timestamp)
PARTITION BY toYYYYMM(timestamp)
SETTINGS index_granularity = 8192;

-- Index for efficient audit log queries
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON kpi_audit_log (timestamp) TYPE minmax GRANULARITY 1;
CREATE INDEX IF NOT EXISTS idx_audit_product ON kpi_audit_log (product_id, week, year) TYPE minmax GRANULARITY 1;

-- ==============================================================================
-- Materialized Views (Optional - for performance)
-- ==============================================================================

-- Materialized view for quick lookups of latest edits
CREATE MATERIALIZED VIEW IF NOT EXISTS kpi_latest_edits
ENGINE = MergeTree()
ORDER BY (product_id, last_edited_timestamp)
POPULATE AS
SELECT
    product_id,
    product_name,
    week,
    year,
    last_edited_kpi,
    last_edited_timestamp
FROM kpi_data
WHERE last_edited_kpi IS NOT NULL
ORDER BY last_edited_timestamp DESC;

-- Materialized view for KPI change summary (aggregated stats)
CREATE MATERIALIZED VIEW IF NOT EXISTS kpi_change_summary
ENGINE = SummingMergeTree()
ORDER BY (product_id, year, week, kpi_name)
POPULATE AS
SELECT
    product_id,
    year,
    week,
    kpi_name,
    count() as change_count,
    max(timestamp) as last_change
FROM kpi_audit_log
GROUP BY product_id, year, week, kpi_name;
