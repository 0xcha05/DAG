# Allocate-Then-Recalculate Workflow Pattern

## Overview

This document explains the allocate-then-recalculate pattern used in the KPI workflow generator. This pattern separates the allocation of edited KPI values from the recalculation of dependent KPIs, creating a clear dependency chain.

## The Pattern

### Traditional Monolithic Approach (OLD)

```sql
CREATE TEMPORARY TABLE kpi_edited_temp_table ENGINE = Memory AS
WITH edited_data AS (
  SELECT
    product_id,
    week,
    year,
    -- Apply edit AND recalculate ALL dependent KPIs in one CTE
    multiIf(...) AS written_sales_dollars,
    if(..., written_sales_dollars / written_sales_units, written_aur) AS written_aur,
    if(..., discount_dollars / (discount_dollars + written_sales_dollars), written_dr_perc) AS written_dr_perc,
    if(..., written_sales_dollars - cogs, written_gm_dollar) AS written_gm_dollar,
    if(..., written_gm_dollar / written_sales_dollars, written_gm_perc) AS written_gm_perc,
    if(..., return_units * written_aur, return_dollars) AS return_dollars,
    if(..., written_sales_dollars - return_dollars, net_sales_dollars) AS net_sales_dollars
  FROM kpi_edit_base_temp_table
)
SELECT * FROM edited_data
```

**Problems:**
- Single monolithic step - hard to debug
- No clear dependency tracking
- All calculations happen at once (some may reference stale values)
- Can't clean up intermediate results
- Harder to maintain and extend

### Allocate-Then-Recalculate Approach (NEW)

```
Step 1: Allocate written_sales_dollars
  ↓
Step 2: Recalculate written_aur (depends on written_sales_dollars)
  ↓
Step 3: Recalculate written_dr_perc (depends on written_sales_dollars)
  ↓
Step 4: Recalculate written_gm_dollar (depends on written_sales_dollars)
  ↓
Step 5: Recalculate written_gm_perc (depends on written_gm_dollar)
  ↓
Step 6: Recalculate return_dollars (depends on written_aur)
  ↓
Step 7: Recalculate net_sales_dollars (depends on return_dollars)
  ↓
Step 8: Final projection (rename columns)
```

**Benefits:**
- Clear dependency chain
- Each step creates a temp table
- Intermediate tables can be cleaned up
- Easy to debug (inspect intermediate results)
- Easy to extend (add new steps)
- Follows topological sort order

## Dependency Graph

```
written_sales_dollars (edited)
    ├─→ written_aur
    │   └─→ return_dollars
    │       └─→ net_sales_dollars
    ├─→ written_dr_perc
    ├─→ written_gm_dollar
    │   └─→ written_gm_perc
    └─→ net_sales_dollars
```

## Step Structure

Each step follows this template:

```json
{
  "step_id": "unique_identifier",
  "source_table": "previous_temp_table",
  "target_table": "new_temp_table",
  "process_sql": "CREATE TEMPORARY TABLE new_temp_table ENGINE = Memory AS SELECT ...",
  "cleanup_source": true/false,
  "dependencies": ["previous_step_id"]
}
```

### Key Fields

- **step_id**: Unique identifier for dependency tracking
- **source_table**: Input temp table (from previous step)
- **target_table**: Output temp table (for next step)
- **process_sql**: ClickHouse SQL to create new temp table
- **cleanup_source**: Whether to drop source table after step completes
- **dependencies**: List of step IDs that must complete first

## SQL Pattern for Each Step

Each recalculation step uses `multiIf()` to conditionally update only within the edited date range:

```sql
CREATE TEMPORARY TABLE recalc_xxx_temp ENGINE = Memory AS
SELECT
  product_id,
  week,
  year,
  -- ... other columns pass through unchanged ...

  multiIf(
    -- Condition: Is this row in the edited date range?
    toDate(year, 1, 1) + toIntervalWeek(week - 1) >= toDate({start_date})
    AND toDate(year, 1, 1) + toIntervalWeek(week - 1) <= toDate({end_date}),

    -- TRUE: Recalculate the KPI
    if(denominator > 0, numerator / denominator, original_value),

    -- FALSE: Keep original value
    original_value
  ) AS kpi_column,

  -- ... other columns ...
FROM previous_temp_table
```

## Example: written_aur Recalculation

**Formula:** `written_aur = written_sales_dollars / written_sales_units`

**SQL:**
```sql
CREATE TEMPORARY TABLE recalc_aur_temp ENGINE = Memory AS
SELECT
  product_id,
  week,
  year,
  l0_name,
  l1_name,
  l2_name,
  channel,

  written_sales_dollars,  -- Already allocated in previous step
  written_sales_units,     -- Unchanged

  multiIf(
    -- Only recalculate for edited date range
    toDate(year, 1, 1) + toIntervalWeek(week - 1) >= toDate({start_date})
    AND toDate(year, 1, 1) + toIntervalWeek(week - 1) <= toDate({end_date}),

    -- Recalculate: AUR = Sales $ / Sales Units
    if(written_sales_units > 0, written_sales_dollars / written_sales_units, written_aur),

    -- Keep original
    written_aur
  ) AS written_aur,

  -- ... other KPIs pass through unchanged ...
FROM allocated_written_sls_temp
```

## Allocation Step

The first step handles allocation based on edit type:

```sql
multiIf(
  -- Condition: Is this row in the edited date range?
  toDate(year, 1, 1) + toIntervalWeek(week - 1) >= toDate({start_date})
  AND toDate(year, 1, 1) + toIntervalWeek(week - 1) <= toDate({end_date}),

  -- TRUE: Apply allocation
  CASE
    WHEN {edit_type} = 'PERCENTAGE' THEN
      -- Percentage edit: multiply by (1 + percentage/100)
      written_sales_dollars * (1 + {new_value} / 100)

    WHEN {edit_type} = 'ABSOLUTE' THEN
      -- Absolute edit: allocate using pro-rata
      {new_value} * (written_sales_dollars / SUM(written_sales_dollars) OVER ())

    ELSE
      -- Fallback: keep original
      written_sales_dollars
  END,

  -- FALSE: Keep original value
  written_sales_dollars
) AS written_sales_dollars
```

## Workflow Output Format

```json
{
  "steps": [
    {
      "step_id": "allocate_written_sales_dollars",
      "source_table": "kpi_edit_base_temp_table",
      "target_table": "allocated_written_sls_temp",
      "process_sql": "CREATE TEMPORARY TABLE ...",
      "cleanup_source": false,
      "dependencies": []
    },
    {
      "step_id": "recalc_written_aur",
      "source_table": "allocated_written_sls_temp",
      "target_table": "recalc_aur_temp",
      "process_sql": "CREATE TEMPORARY TABLE ...",
      "cleanup_source": true,
      "dependencies": ["allocate_written_sales_dollars"]
    }
    // ... more steps ...
  ],
  "final_output_table": "kpi_edited_temp_table"
}
```

## Orchestrator Integration

**What the orchestrator does:**
1. Load base data → `kpi_edit_base_temp_table`
2. Execute workflow steps in dependency order
3. Insert final results from `final_output_table`

**What the workflow generator does:**
- Generate transformation steps only
- Define dependencies
- Specify temp table names
- Return final output table name

## Testing the Pattern

You can verify each step independently:

```sql
-- After step 1: Check allocation
SELECT product_id, week, written_sales_dollars
FROM allocated_written_sls_temp
WHERE week BETWEEN 1 AND 4;

-- After step 2: Check AUR recalculation
SELECT product_id, week, written_sales_dollars, written_sales_units, written_aur
FROM recalc_aur_temp
WHERE week BETWEEN 1 AND 4;

-- After step N: Check final results
SELECT * FROM kpi_edited_temp_table
WHERE week BETWEEN 1 AND 4;
```

## Summary

**Key Principles:**
1. **Separate allocation from recalculation** - clear responsibility
2. **One KPI per step** - easy to debug
3. **Explicit dependencies** - topological order
4. **Temp table chain** - clean intermediate results
5. **Conditional updates** - only edited date range affected
6. **Pass-through pattern** - unchanged columns flow through

This pattern makes the workflow:
- **Testable**: Inspect each step's output
- **Debuggable**: Isolate issues to specific steps
- **Maintainable**: Add/remove steps easily
- **Correct**: Dependency order guaranteed
