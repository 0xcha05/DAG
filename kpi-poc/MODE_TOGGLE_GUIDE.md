# Execution Mode Toggle Guide

The KPI Rebalancing Engine now supports two execution modes: **In-Memory** and **ClickHouse Query Generation**.

## Overview

A toggle switch in the header allows you to switch between:
1. **In-Memory Mode** - Traditional execution (data updates in real-time)
2. **ClickHouse Mode** - Query generation only (shows SQL, doesn't execute)

## How It Works

### In-Memory Mode (Default)

**What happens:**
- User edits a KPI value
- Rebalancing engine calculates dependent KPIs
- Data is updated immediately
- Grid shows yellow highlights for changed values
- Logs are recorded
- Change history is displayed

**Use this mode for:**
- Testing rebalancing logic
- Interactive exploration of dependencies
- Real-time "what-if" analysis
- Demonstrating the DAG-based calculation engine

### ClickHouse Mode

**What happens:**
- User edits a KPI value
- Rebalancing engine calculates what WOULD change (but doesn't apply it)
- SQL queries are generated for each operation
- Modal displays all queries with parameters
- Highlights show what would change (preview)
- **Data remains unchanged**

**Generated queries include:**
1. **User Edit Log** - `INSERT INTO kpi_audit_log` with type='user-edit'
2. **Update Edited KPI** - `ALTER TABLE kpi_data UPDATE` for the edited value
3. **System Recalc Logs** - `INSERT INTO kpi_audit_log` for each dependent KPI (with formula, level, trigger)
4. **Update Dependent KPIs** - `ALTER TABLE kpi_data UPDATE` for each recalculated value

**Use this mode for:**
- Understanding what SQL would be generated
- Debugging query structure
- Planning database integration
- Reviewing batch operations before execution
- Teaching/documentation purposes

## Example: User Edits "Sls U" from 1000 → 1200

### In-Memory Mode
```
✓ Data updated
✓ COGS recalculated: 6000 → 7200
✓ GM $ recalculated: 4000 → 4800
✓ EOP U recalculated: 440 → 238
✓ Week 11 BOP U updated: 440 → 238
✓ Logs recorded
```

### ClickHouse Mode
```
Modal displays 11 queries:

1. INSERT INTO kpi_audit_log (user-edit, Sls U)
2. ALTER TABLE kpi_data UPDATE sls_u = 1200
3. INSERT INTO kpi_audit_log (system-recalc, COGS, level 1)
4. ALTER TABLE kpi_data UPDATE cogs = 7200
5. INSERT INTO kpi_audit_log (system-recalc, GM $, level 2)
6. ALTER TABLE kpi_data UPDATE gm_dollars = 4800
7. INSERT INTO kpi_audit_log (system-recalc, EOP U, level 3)
8. ALTER TABLE kpi_data UPDATE eop_u = 238
9. INSERT INTO kpi_audit_log (system-recalc, BOP U week 11)
10. ALTER TABLE kpi_data UPDATE bop_u = 238 (week 11)
... (and more)

Data unchanged - queries shown only
```

## UI Elements

### Header Toggle
```
┌─────────────┬──────────────┐
│ In-Memory   │  ClickHouse  │  ← Click to switch
│   (blue)    │   (green)    │
└─────────────┴──────────────┘
```

**In-Memory Selected:**
- Blue highlight
- "✓ In-Memory Mode: Changes are applied immediately..."

**ClickHouse Selected:**
- Green highlight
- "⚡ ClickHouse Mode: Generates SQL queries without executing..."

### Query Modal (ClickHouse Mode Only)

When you edit a cell in ClickHouse mode, a modal appears showing:

```
┌─────────────────────────────────────────────────────┐
│ Generated ClickHouse Queries                    [X] │
│ 11 queries generated (not executed)                 │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Query 1 of 11                                      │
│ Log user edit: Sls U (1000.00 → 1200.00)          │
│ ┌─────────────────────────────────────────────┐  │
│ │ INSERT INTO kpi_audit_log (                  │  │
│ │   id, timestamp, log_type, product_id,       │  │
│ │   week, year, kpi_name, old_value,           │  │
│ │   new_value, user_id                         │  │
│ │ ) VALUES (                                    │  │
│ │   generateUUIDv4(),                           │  │
│ │   now(),                                      │  │
│ │   'user-edit',                                │  │
│ │   {productId:String},                         │  │
│ │   ...                                         │  │
│ └─────────────────────────────────────────────┘  │
│                                                     │
│ Parameters:                                        │
│ productId = 'PROD-001'                             │
│ week = 10                                          │
│ kpiName = 'Sls U'                                  │
│ oldValue = 1000                                    │
│ newValue = 1200                                    │
│                                                     │
│ [Scroll for more queries...]                      │
│                                                     │
├─────────────────────────────────────────────────────┤
│ These queries are generated but not executed.       │
│                                    [Close]          │
└─────────────────────────────────────────────────────┘
```

### Grid Instructions (Context-Aware)

**In-Memory Mode:**
- "Watch dependent KPIs recalculate automatically"
- "Yellow highlights show changed values"

**ClickHouse Mode:**
- "ClickHouse mode: Edits will generate SQL queries instead of updating data"
- "Queries show INSERT (logs) and UPDATE (values) statements"

## Technical Details

### Query Generation Flow

```
User Edit
    ↓
KPIEngine.rebalance() (calculates changes in-memory)
    ↓
If mode === 'clickhouse':
    ↓
generateRebalancingQueries()
    ↓
For each change:
  - Generate audit log INSERT
  - Generate value UPDATE
    ↓
Display in QueryDisplay modal
```

### Key Files

- **App.tsx** - Mode toggle and conditional logic
- **QueryDisplay.tsx** - Modal component for showing queries
- **clickhouse-query-service.ts** - Converts rebalancing results to SQL

### Query Structure

All queries use parameterized syntax for safety:
```sql
ALTER TABLE kpi_data
UPDATE sls_u = {newValue:Float64}
WHERE product_id = {productId:String}
  AND week = {week:UInt8}
```

Parameters are shown separately:
```
newValue = 1200
productId = 'PROD-001'
week = 10
```

## Benefits

### For Development
- Test logic without database
- See exact SQL before execution
- Debug query generation
- Optimize before deployment

### For Demo/Teaching
- Show SQL structure
- Explain database operations
- Compare in-memory vs persistent storage
- Understand query complexity

### For Planning
- Review batch operations
- Estimate query volume
- Plan indexing strategy
- Optimize table structure

## Switching Modes

**From In-Memory to ClickHouse:**
- Current data preserved
- Next edit shows queries
- No data changes on edits

**From ClickHouse to In-Memory:**
- Current data preserved
- Next edit updates data
- Normal rebalancing resumes

**Tip:** You can switch modes anytime - data persists across mode changes when in In-Memory mode.

## Limitations

**ClickHouse Mode:**
- Queries are generated but NOT executed
- No actual database connection
- Data doesn't change (it's just a preview)
- Highlights clear after 5 seconds (longer than in-memory to review queries)

**In-Memory Mode:**
- Data lives in browser memory only
- Resets on page refresh
- No persistence between sessions

## Future Enhancements

Potential additions:
- Export queries to .sql file
- Copy individual queries to clipboard
- Execute queries against real ClickHouse
- Query performance estimates
- Transaction grouping options
