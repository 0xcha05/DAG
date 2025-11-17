# ClickHouse Schema & Query Generation

This directory contains the ClickHouse schema design and query generation logic for the KPI Rebalancing Engine.

**Note:** This implementation focuses on **schema design** and **query generation** without actual execution. You can review the generated SQL queries before connecting to a ClickHouse database.

## Overview

The system stores KPI data, configurations, and audit logs in ClickHouse using three main tables:

1. **`kpi_config`** - Stores dynamic KPI templates (formulas, dependencies, lock strategies)
2. **`kpi_data`** - Stores actual KPI values per product per week
3. **`kpi_audit_log`** - Tracks all changes (user edits and system recalculations)

## Table Schemas

### 1. kpi_config

Stores the dynamic KPI configuration (replaces hardcoded JSON config).

```sql
CREATE TABLE kpi_config (
    kpi_name String,                    -- e.g., "Sls U", "COGS", "GM %"
    display_name String,                -- Human-readable name
    is_editable UInt8,                  -- 1 = editable, 0 = calculated
    formula Nullable(String),           -- e.g., "Sls U * AUC"
    description Nullable(String),
    depends_on String DEFAULT '[]',     -- JSON array: ["Sls U", "AUC"]
    locks_when_edited String DEFAULT '[]', -- JSON array: ["DR%", "Return %"]
    affects_weeks String DEFAULT '[]',  -- JSON array: [{"offset": 4, "targetKPI": "Return Inv"}]
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now(),
    version UInt32 DEFAULT 1
)
ENGINE = ReplacingMergeTree(version)
ORDER BY (kpi_name);
```

**Key Features:**
- `ReplacingMergeTree` engine automatically keeps latest version of each KPI config
- JSON arrays store dependencies, lock strategies, and multi-week effects
- `version` column enables config versioning and rollback

### 2. kpi_data

Stores actual KPI values for each product and week.

```sql
CREATE TABLE kpi_data (
    product_id String,
    product_name String,
    week UInt8,
    year UInt16,

    -- KPI columns (25+ KPIs)
    sls_u Float64 DEFAULT 0,
    sls_dollars Float64 DEFAULT 0,
    cogs Float64 DEFAULT 0,
    gm_dollars Float64 DEFAULT 0,
    gm_percent Float64 DEFAULT 0,
    eop_u Float64 DEFAULT 0,
    bop_u Float64 DEFAULT 0,
    -- ... (see schema.sql for full list)

    -- Metadata
    last_edited_kpi Nullable(String),
    last_edited_timestamp Nullable(DateTime),
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
ORDER BY (product_id, year, week)
PARTITION BY (product_id, year);
```

**Key Features:**
- Wide table with all KPIs as columns (optimized for OLAP queries)
- Partitioned by product and year for efficient pruning
- Tracks last edit for each row
- Ordered by (product, year, week) for time-series queries

### 3. kpi_audit_log

Tracks all changes for auditability.

```sql
CREATE TABLE kpi_audit_log (
    id UUID DEFAULT generateUUIDv4(),
    timestamp DateTime DEFAULT now(),
    log_type Enum8('user-edit' = 1, 'system-recalc' = 2),
    product_id String,
    week UInt8,
    year UInt16,
    kpi_name String,
    old_value Float64,
    new_value Float64,
    triggered_by Nullable(String),      -- For system recalcs
    calculation_level Nullable(UInt8),  -- Dependency level
    formula Nullable(String),           -- Formula used
    user_id Nullable(String)
)
ENGINE = MergeTree()
ORDER BY (product_id, timestamp)
PARTITION BY toYYYYMM(timestamp);
```

**Key Features:**
- Partitioned by month for efficient archival
- Distinguishes user edits from system recalculations
- Stores calculation metadata (level, formula, trigger)
- UUID for unique log identification

## Query Generation

The `KPIQueryBuilder` class generates SQL queries without executing them.

### Basic Operations

```typescript
import { KPIQueryBuilder, formatQuery } from '../server/query-builder';

// Fetch product data
const query = KPIQueryBuilder.getProductData('PROD-001');
console.log(formatQuery(query));
```

**Generated SQL:**
```sql
-- Fetch all week data for product PROD-001
SELECT *
FROM kpi_data
WHERE product_id = {productId:String}
ORDER BY week ASC

-- Parameters:
-- productId = 'PROD-001'
```

### Update Operations

```typescript
// Update single KPI
const query = KPIQueryBuilder.updateSingleKPI(
  'PROD-001',
  10,
  'Sls U',
  1200
);
```

**Generated SQL:**
```sql
-- Update Sls U to 1200 for product PROD-001, week 10
ALTER TABLE kpi_data
UPDATE
  sls_u = {newValue:Float64},
  last_edited_kpi = {kpiName:String},
  last_edited_timestamp = now(),
  updated_at = now()
WHERE product_id = {productId:String}
  AND week = {week:UInt8}

-- Parameters:
-- productId = 'PROD-001'
-- week = 10
-- kpiName = 'Sls U'
-- newValue = 1200
```

### Batch Updates (Rebalancing)

```typescript
// Generate queries for full rebalancing scenario
const queries = KPIQueryBuilder.generateRebalancingQueries(
  'PROD-001',
  10,
  2024,
  'Sls U',
  1200,
  [
    { kpi: 'COGS', oldValue: 6000, newValue: 7200,
      triggeredBy: 'Sls U', calculationLevel: 1, formula: 'Sls U * AUC' },
    { kpi: 'GM $', oldValue: 4000, newValue: 4800,
      triggeredBy: 'Sls U', calculationLevel: 2, formula: 'Sls $ - COGS' },
    // ... more recalculations
  ]
);

// Returns array of queries:
// 1. Log user edit
// 2. Update Sls U
// 3. Log COGS recalc
// 4. Update COGS
// 5. Log GM $ recalc
// 6. Update GM $
// ... etc
```

### Configuration Updates

```typescript
// Update KPI formula dynamically
const query = KPIQueryBuilder.updateKPIConfig('COGS', {
  formula: 'Sls U * AUC * 1.05',  // Add 5% overhead
  dependsOn: ['Sls U', 'AUC'],
});
```

**Generated SQL:**
```sql
-- Update configuration for KPI: COGS
ALTER TABLE kpi_config
UPDATE updated_at = now(),
       version = version + 1,
       formula = {formula:String},
       depends_on = {dependsOn:String}
WHERE kpi_name = {kpiName:String}

-- Parameters:
-- kpiName = 'COGS'
-- formula = 'Sls U * AUC * 1.05'
-- dependsOn = '["Sls U","AUC"]'
```

## Example Queries

Run the examples to see generated queries:

```bash
npx tsx clickhouse/query-examples.ts
```

This will output:
- Basic fetch queries
- Single and batch updates
- Full rebalancing scenarios
- Multi-week effects (EOP→BOP, Return Inventory)
- Audit log queries
- Configuration updates

## Key Design Decisions

### 1. Wide Table vs. Narrow Table

**Chosen: Wide Table** (`kpi_data` with 25+ columns)

**Pros:**
- Optimized for OLAP queries (fetch all KPIs for a week in one query)
- Simpler joins (no need to pivot)
- Better compression (same product/week metadata repeated once)
- Faster aggregations

**Cons:**
- Adding new KPIs requires schema changes
- Less flexible for dynamic KPI definitions

**Mitigation:** Store KPI definitions in `kpi_config` table for metadata and formulas.

### 2. Configuration as Data

**Chosen: Store config in `kpi_config` table**

**Pros:**
- Dynamic formulas without code deployment
- Version tracking and audit trail
- Can query config history
- Business users can update formulas

**Cons:**
- Requires parsing JSON in application layer
- More complex than hardcoded config

### 3. Audit Log Design

**Chosen: Separate `kpi_audit_log` table**

**Pros:**
- Immutable audit trail
- Partitioned by month for efficient archival
- Distinguishes user edits from system recalcs
- Stores calculation metadata (formula, trigger, level)

**Cons:**
- Duplicate storage of value changes
- Requires join to get full context

### 4. ReplacingMergeTree for Config

**Chosen: `ReplacingMergeTree(version)`**

**Pros:**
- Automatically keeps latest version
- Deduplication by kpi_name
- Version column for explicit control
- Can query historical versions before merge

**Cons:**
- Final merge happens asynchronously
- Must use `FINAL` for guaranteed latest version

## Query Patterns

### Read Patterns

```sql
-- Get all data for a product
SELECT * FROM kpi_data
WHERE product_id = 'PROD-001'
ORDER BY week;

-- Get specific week
SELECT * FROM kpi_data
WHERE product_id = 'PROD-001' AND week = 10;

-- Get time series for one KPI
SELECT week, sls_u FROM kpi_data
WHERE product_id = 'PROD-001'
ORDER BY week;

-- Get latest config
SELECT * FROM kpi_config FINAL;

-- Get config for specific KPI
SELECT * FROM kpi_config FINAL
WHERE kpi_name = 'COGS';
```

### Write Patterns

```sql
-- Update single KPI
ALTER TABLE kpi_data
UPDATE sls_u = 1200,
       last_edited_kpi = 'Sls U',
       last_edited_timestamp = now(),
       updated_at = now()
WHERE product_id = 'PROD-001' AND week = 10;

-- Batch update multiple KPIs
ALTER TABLE kpi_data
UPDATE sls_u = 1200,
       cogs = 7200,
       gm_dollars = 4800,
       updated_at = now()
WHERE product_id = 'PROD-001' AND week = 10;

-- Insert audit log
INSERT INTO kpi_audit_log (log_type, product_id, week, year, kpi_name, old_value, new_value)
VALUES ('user-edit', 'PROD-001', 10, 2024, 'Sls U', 1000, 1200);
```

### Multi-Week Patterns

```sql
-- EOP → BOP propagation (Week 10 → Week 11)
-- Step 1: Update Week 10 EOP
ALTER TABLE kpi_data UPDATE eop_u = 238
WHERE product_id = 'PROD-001' AND week = 10;

-- Step 2: Update Week 11 BOP
ALTER TABLE kpi_data UPDATE bop_u = 238
WHERE product_id = 'PROD-001' AND week = 11;

-- Return Inventory (Week 10 → Week 14)
-- Step 1: Calculate return_inv for Week 14
-- return_inv = Week 10 return_u * 0.9
ALTER TABLE kpi_data UPDATE return_inv = 13.5
WHERE product_id = 'PROD-001' AND week = 14;
```

## Performance Considerations

### Indexing

```sql
-- Primary key provides ordering
ORDER BY (product_id, year, week)

-- Additional indexes for common queries
CREATE INDEX idx_product_week ON kpi_data (product_id, year, week);
CREATE INDEX idx_audit_timestamp ON kpi_audit_log (timestamp);
```

### Partitioning

```sql
-- kpi_data: Partition by product and year
PARTITION BY (product_id, year)

-- kpi_audit_log: Partition by month for archival
PARTITION BY toYYYYMM(timestamp)
```

### Materialized Views

```sql
-- Pre-aggregate change counts
CREATE MATERIALIZED VIEW kpi_change_summary
ENGINE = SummingMergeTree()
ORDER BY (product_id, year, week, kpi_name)
AS SELECT
    product_id, year, week, kpi_name,
    count() as change_count,
    max(timestamp) as last_change
FROM kpi_audit_log
GROUP BY product_id, year, week, kpi_name;
```

## Next Steps

To actually execute these queries:

1. **Setup ClickHouse:**
   ```bash
   # Install ClickHouse locally or use Docker
   docker run -d -p 8123:8123 --name clickhouse clickhouse/clickhouse-server
   ```

2. **Initialize Schema:**
   ```bash
   npm run clickhouse:init    # Runs schema.sql
   npm run clickhouse:seed    # Runs seed.sql and seed-config.sql
   ```

3. **Connect & Execute:**
   ```typescript
   import { getClickHouseClient } from './server/db/clickhouse';
   import { KPIQueryBuilder } from './server/query-builder';

   const client = getClickHouseClient();
   const query = KPIQueryBuilder.getProductData('PROD-001');

   const result = await client.query({
     query: query.sql,
     query_params: query.params,
     format: 'JSONEachRow',
   });

   const data = await result.json();
   console.log(data);
   ```

## Files in This Directory

- **`schema.sql`** - Table definitions and indexes
- **`seed.sql`** - Sample KPI data for Product 001
- **`seed-config.sql`** - KPI configuration templates
- **`query-examples.ts`** - Demonstrates generated queries
- **`README.md`** - This file

## Query Builder API

See `../server/query-builder.ts` for full API:

- `getProductData(productId)` - Fetch all weeks
- `getWeekData(productId, week)` - Fetch specific week
- `updateSingleKPI(productId, week, kpi, value)` - Update one KPI
- `updateMultipleKPIs(productId, week, values)` - Batch update
- `logUserEdit(entry, productId, year)` - Log user change
- `logSystemRecalc(entry, productId, year)` - Log system recalc
- `getAuditLogs(productId, startWeek, endWeek, limit)` - Fetch logs
- `getKPIConfig(kpiName?)` - Fetch configurations
- `updateKPIConfig(kpiName, updates)` - Update config
- `generateRebalancingQueries(...)` - Full rebalancing scenario

All methods return `GeneratedQuery` objects with:
- `sql`: The parameterized SQL query
- `params`: Parameter values
- `description`: Human-readable description
