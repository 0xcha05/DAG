# Written Sales Workflow Example

## Overview

This directory contains an example workflow for `written_sales_dollars` KPI edits following the **allocate-then-recalculate pattern**.

## File: written_sales_workflow_hydrated.json

**What it represents:** A fully hydrated workflow JSON output from the workflow generator for a specific payload.

**Example Payload:**
```json
{
  "kpi": "written_sales_dollars",
  "new_value": 50000,
  "edit_type": "ABSOLUTE",
  "time_level": "month",
  "time_value": 1,
  "year": 2024,
  "l1_name": "Shapewear",
  "channel": "Online"
}
```

**Generated Workflow:**
- **8 steps** with fully hydrated SQL (no template variables)
- **Date range:** January 1-31, 2024
- **Allocation:** Pro-rata (ABSOLUTE edit)
- **New value:** 50000

## Key Features

### Fully Hydrated SQL
All SQL statements have **actual values**, not placeholders:
- ✅ `toDate('2024-01-01')` - actual date
- ✅ `50000 * (...)` - actual edit value
- ❌ ~~`toDate({start_date})`~~ - NO template variables
- ❌ ~~`{new_value} * (...)`~~ - NO placeholders

### Step Chain
1. **allocate_written_sales_dollars** - Pro-rata allocation (50000)
2. **recalc_written_aur** - AUR = Sales $ / Sales Units
3. **recalc_written_dr_perc** - DR% = Discount $ / (Discount $ + Sales $)
4. **recalc_written_gm_dollar** - GM$ = Sales $ - COGS
5. **recalc_written_gm_perc** - GM% = GM$ / Sales $
6. **recalc_return_dollars** - Return $ = Return Units * AUR
7. **recalc_net_sales_dollars** - Net Sales $ = Sales $ - Return $
8. **final_projection** - Rename columns for output

### Metadata
The workflow includes metadata for audit/debugging:
```json
{
  "edit_type": "aggregated",
  "kpi": "written_sales_dollars",
  "allocation_strategy": "pro_rata",
  "new_value": 50000,
  "date_range": {
    "start": "2024-01-01",
    "end": "2024-01-31"
  }
}
```

## Usage for Orchestrator

The orchestrator should:

1. **Load base data** → `kpi_edit_base_temp_table`
   - Filter to matching rows (l1_name = 'Shapewear', channel = 'Online', etc.)
   - Include all KPI columns

2. **Execute steps sequentially**
   - Respect `dependencies` array
   - Create temp tables as specified
   - Clean up source tables when `cleanup_source: true`

3. **Insert final results** from `kpi_edited_temp_table`
   - Insert into target database/table
   - Drop temp table after insert

## Example Orchestrator Pseudocode

```python
workflow = load_workflow("written_sales_workflow_hydrated.json")

# Step 0: Load base data (orchestrator responsibility)
execute_sql("CREATE TEMPORARY TABLE kpi_edit_base_temp_table ...")

# Steps 1-8: Execute workflow
for step in topological_order(workflow["steps"]):
    execute_sql(step["process_sql"])

    if step["cleanup_source"]:
        execute_sql(f"DROP TABLE {step['source_table']}")

# Final step: Insert results (orchestrator responsibility)
execute_sql(f"""
    INSERT INTO kpi_data_prod
    SELECT * FROM {workflow['final_output_table']}
""")

# Cleanup
execute_sql(f"DROP TABLE {workflow['final_output_table']}")
```

## Testing Individual Steps

You can inspect intermediate results:

```sql
-- After allocation
SELECT product_id, week, written_sales_dollars
FROM allocated_written_sls_temp
WHERE week BETWEEN 1 AND 4
ORDER BY product_id, week;

-- After AUR recalculation
SELECT product_id, week,
       written_sales_dollars,
       written_sales_units,
       written_aur
FROM recalc_aur_temp
WHERE week BETWEEN 1 AND 4;

-- Final results
SELECT * FROM kpi_edited_temp_table
WHERE week BETWEEN 1 AND 4;
```

## Different Edit Types

The workflow generator produces different SQL based on edit type:

**ABSOLUTE edit (this example):**
```sql
50000 * (written_sales_dollars / SUM(written_sales_dollars) OVER ())
```

**PERCENTAGE edit (+20%):**
```sql
written_sales_dollars * 1.2
```

**The workflow generator handles this logic** - the orchestrator only executes the SQL.
