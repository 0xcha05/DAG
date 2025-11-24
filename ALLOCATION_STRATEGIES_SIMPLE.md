# Allocation Strategies - Technical Guide

A focused guide on the two core allocation strategies: **Pro-Rata** and **Equal Distribution**.

---

## 📖 The Allocation Problem

### What We're Solving

When a user edits at an **aggregated level**, we need to distribute that value to multiple **granular rows**.

**Example:**
```
USER SAYS: "Electronics department, January 2024 → 50,000 units"
SYSTEM MUST: Update 200 product-week rows to sum to 50,000
QUESTION: How much does each row get?
```

### Visual Understanding

```
AGGREGATED EDIT LEVEL:
┌─────────────────────────────────┐
│ dept = Electronics              │
│ month = January (weeks 1-4)     │
│ Target Value: 50,000 units      │
└─────────────────────────────────┘
                ↓
        ALLOCATION ALGORITHM
                ↓
GRANULAR STORAGE LEVEL:
┌────────────┬──────┬──────┬────────────┐
│ product_id │ week │ year │ new_value  │
├────────────┼──────┼──────┼────────────┤
│ PROD-001   │ 1    │ 2024 │ ???        │
│ PROD-001   │ 2    │ 2024 │ ???        │
│ PROD-001   │ 3    │ 2024 │ ???        │
│ PROD-001   │ 4    │ 2024 │ ???        │
│ PROD-002   │ 1    │ 2024 │ ???        │
│ ...        │ ...  │ ...  │ ...        │
└────────────┴──────┴──────┴────────────┘
200 rows need values that sum to 50,000
```

### The Two Approaches

| Strategy | Philosophy | Math |
|----------|-----------|------|
| **Pro-Rata** | "Preserve current proportions" | `new = target × (current / sum)` |
| **Equal** | "Split evenly, ignore current" | `new = target / count` |

---

## 1️⃣ Pro-Rata Allocation

### Concept

**Pro-rata** means "proportional" - each row gets a share based on its **current value relative to the total**.

**Key Idea:** If a row currently has 10% of the total, it will still have 10% after allocation.

### The Math

```
For each row:
  weight = current_value / SUM(all_current_values)
  new_value = target_total × weight
```

### Example Walkthrough

**Current State:**
```
product_id | week | year | current_sls_u
-----------|------|------|---------------
PROD-001   | 1    | 2024 | 100
PROD-001   | 2    | 2024 | 150
PROD-001   | 3    | 2024 | 120
PROD-001   | 4    | 2024 | 130
PROD-002   | 1    | 2024 | 200
PROD-002   | 2    | 2024 | 250
PROD-002   | 3    | 2024 | 220
PROD-002   | 4    | 2024 | 230
                           ─────
                    Total: 1400
```

**User Edit:**
```
dept = "Electronics"
month = January (weeks 1-4)
year = 2024
target_value = 2000
```

### Step-by-Step Technical Flow

#### Step 1: Calculate Current Aggregate

```sql
SELECT SUM(sls_u) as current_total
FROM kpi_data
WHERE dept = 'Electronics'
  AND week BETWEEN 1 AND 4
  AND year = 2024

-- Result: 1400
```

**Delta:** `2000 - 1400 = +600` (need to add 600 total)

#### Step 2: Calculate Weights for Each Row

```sql
SELECT
    product_id,
    week,
    year,
    sls_u as current_value,
    SUM(sls_u) OVER () as total,
    sls_u / SUM(sls_u) OVER () as weight
FROM kpi_data
WHERE dept = 'Electronics'
  AND week BETWEEN 1 AND 4
  AND year = 2024
```

**Result:**
```
product_id | week | current | total | weight
-----------|------|---------|-------|--------
PROD-001   | 1    | 100     | 1400  | 0.0714  (100/1400)
PROD-001   | 2    | 150     | 1400  | 0.1071  (150/1400)
PROD-001   | 3    | 120     | 1400  | 0.0857  (120/1400)
PROD-001   | 4    | 130     | 1400  | 0.0929  (130/1400)
PROD-002   | 1    | 200     | 1400  | 0.1429  (200/1400)
PROD-002   | 2    | 250     | 1400  | 0.1786  (250/1400)
PROD-002   | 3    | 220     | 1400  | 0.1571  (220/1400)
PROD-002   | 4    | 230     | 1400  | 0.1643  (230/1400)
                                     ─────
                                     1.0000 ✓
```

**Key Observation:**
- `OVER ()` means "across ALL rows in the result set"
- No GROUP BY needed - window function preserves individual rows
- Each row knows its weight AND the total

#### Step 3: Apply New Values

```sql
SELECT
    product_id,
    week,
    year,
    weight,
    2000 * weight as new_value
FROM (previous query)
```

**Result:**
```
product_id | week | weight  | new_value | calculation
-----------|------|---------|-----------|----------------------
PROD-001   | 1    | 0.0714  | 142.86    | 2000 × 0.0714
PROD-001   | 2    | 0.1071  | 214.29    | 2000 × 0.1071
PROD-001   | 3    | 0.0857  | 171.43    | 2000 × 0.0857
PROD-001   | 4    | 0.0929  | 185.71    | 2000 × 0.0929
PROD-002   | 1    | 0.1429  | 285.71    | 2000 × 0.1429
PROD-002   | 2    | 0.1786  | 357.14    | 2000 × 0.1786
PROD-002   | 3    | 0.1571  | 314.29    | 2000 × 0.1571
PROD-002   | 4    | 0.1643  | 328.57    | 2000 × 0.1643
                            ──────
                            2000.00 ✓
```

#### Step 4: Execute UPDATE

```sql
ALTER TABLE kpi_data AS target
UPDATE sls_u = (
    SELECT
        2000 * (sls_u / SUM(sls_u) OVER ())
    FROM kpi_data AS source
    WHERE source.product_id = target.product_id
      AND source.week = target.week
      AND source.year = target.year
)
WHERE dept = 'Electronics'
  AND week BETWEEN 1 AND 4
  AND year = 2024
```

### Verification

**Before:**
```
PROD-001 total: 100+150+120+130 = 500 (35.7% of 1400)
PROD-002 total: 200+250+220+230 = 900 (64.3% of 1400)
```

**After:**
```
PROD-001 total: 142.86+214.29+171.43+185.71 = 714.29 (35.7% of 2000) ✓
PROD-002 total: 285.71+357.14+314.29+328.57 = 1285.71 (64.3% of 2000) ✓
```

**Proportions preserved!** PROD-002 still has ~1.8x more than PROD-001.

### Understanding Window Functions

**The Magic of `OVER ()`:**

```sql
-- This DOES NOT require GROUP BY
SELECT
    product_id,
    sls_u,
    SUM(sls_u) OVER () as total_sum
FROM kpi_data
WHERE dept = 'Electronics'
```

**Result:**
```
product_id | sls_u | total_sum
-----------|-------|----------
PROD-001   | 100   | 1400      ← Same total for every row
PROD-001   | 150   | 1400      ← Same total for every row
PROD-002   | 200   | 1400      ← Same total for every row
...
```

**Why This Works:**
- Window function calculates aggregate (`SUM`) across the entire window
- Window = all rows matching WHERE clause
- Each row retains its identity (product_id, sls_u) AND knows the aggregate
- Perfect for weight calculation: `sls_u / total_sum`

**Compare to GROUP BY (Wrong Approach):**
```sql
-- This LOSES individual rows
SELECT
    product_id,
    SUM(sls_u) as total
FROM kpi_data
WHERE dept = 'Electronics'
GROUP BY product_id
```

**Result:**
```
product_id | total
-----------|------
PROD-001   | 500   ← Collapsed 4 rows into 1
PROD-002   | 900   ← Collapsed 4 rows into 1
```

We lost week-level detail! Window functions solve this.

### Python Implementation

```python
def generate_pro_rata_sql(
    kpi_column: str,
    granularity: List[str],
    where_clause: str,
    database: str,
    table: str,
    new_value: float
) -> str:
    """
    Generate pro-rata allocation SQL using window functions.

    Args:
        kpi_column: Column to update (e.g., "sls_u")
        granularity: Unique key columns (e.g., ["product_id", "week", "year"])
        where_clause: Filter (e.g., "dept = 'Electronics' AND week BETWEEN 1 AND 4")
        database: Database name
        table: Table name
        new_value: Target total value

    Returns:
        SQL ALTER TABLE UPDATE statement
    """

    # Build correlation conditions for subquery
    correlation_conditions = " AND ".join([
        f"source.{col} = target.{col}" for col in granularity
    ])

    sql = f"""
    ALTER TABLE {database}.{table} AS target
    UPDATE {kpi_column} = (
        SELECT
            {new_value} * ({kpi_column} / SUM({kpi_column}) OVER ())
        FROM {database}.{table} AS source
        WHERE {correlation_conditions}
    )
    WHERE {where_clause}
    """

    return sql.strip()
```

**Example Usage:**
```python
sql = generate_pro_rata_sql(
    kpi_column="sls_u",
    granularity=["product_id", "week", "year"],
    where_clause="dept = 'Electronics' AND week BETWEEN 1 AND 4 AND year = 2024",
    database="spanx_kpi_data",
    table="kpi_data",
    new_value=2000
)

print(sql)
```

### When to Use Pro-Rata

**✅ Good For:**
- Scaling up or down while maintaining current mix
- Products with established patterns
- When current distribution is representative
- "Business as usual" scenarios

**Example Scenarios:**
- Increase department sales by 20% → use pro-rata (preserve product mix)
- Scale inventory up for peak season → use pro-rata (keep ratios)
- Budget increase with same strategy → use pro-rata

**❌ Avoid When:**
- All current values are zero (division by zero!)
- Current distribution is broken/unfair
- Need to reset product mix

---

## 2️⃣ Equal Distribution

### Concept

**Equal distribution** ignores current values entirely and splits the target evenly across all rows.

**Key Idea:** Every row gets `target_total / number_of_rows`, period.

### The Math

```
For each row:
  new_value = target_total / COUNT(rows)
```

No weights, no proportions - just simple division.

### Example Walkthrough

**Same Initial State:**
```
product_id | week | year | current_sls_u
-----------|------|------|---------------
PROD-001   | 1    | 2024 | 100
PROD-001   | 2    | 2024 | 150
PROD-001   | 3    | 2024 | 120
PROD-001   | 4    | 2024 | 130
PROD-002   | 1    | 2024 | 200
PROD-002   | 2    | 2024 | 250
PROD-002   | 3    | 2024 | 220
PROD-002   | 4    | 2024 | 230
                           ─────
                    Total: 1400
```

**User Edit:**
```
dept = "Electronics"
month = January (weeks 1-4)
year = 2024
target_value = 2000
```

### Step-by-Step Technical Flow

#### Step 1: Count Affected Rows

```sql
SELECT COUNT(*) as row_count
FROM kpi_data
WHERE dept = 'Electronics'
  AND week BETWEEN 1 AND 4
  AND year = 2024

-- Result: 8 rows
```

#### Step 2: Calculate Per-Row Value

```
per_row_value = 2000 / 8 = 250
```

That's it! Every row gets 250.

#### Step 3: Apply New Values

```sql
SELECT
    product_id,
    week,
    year,
    2000 / COUNT(*) OVER () as new_value
FROM kpi_data
WHERE dept = 'Electronics'
  AND week BETWEEN 1 AND 4
  AND year = 2024
```

**Result:**
```
product_id | week | new_value | calculation
-----------|------|-----------|-------------
PROD-001   | 1    | 250       | 2000 / 8
PROD-001   | 2    | 250       | 2000 / 8
PROD-001   | 3    | 250       | 2000 / 8
PROD-001   | 4    | 250       | 2000 / 8
PROD-002   | 1    | 250       | 2000 / 8
PROD-002   | 2    | 250       | 2000 / 8
PROD-002   | 3    | 250       | 2000 / 8
PROD-002   | 4    | 250       | 2000 / 8
                   ────
                   2000 ✓
```

#### Step 4: Execute UPDATE

```sql
ALTER TABLE kpi_data AS target
UPDATE sls_u = (
    SELECT 2000 / COUNT(*) OVER ()
    FROM kpi_data AS source
    WHERE source.product_id = target.product_id
      AND source.week = target.week
      AND source.year = target.year
)
WHERE dept = 'Electronics'
  AND week BETWEEN 1 AND 4
  AND year = 2024
```

### Verification

**Before:**
```
PROD-001, week 1: 100 (smallest)
PROD-002, week 2: 250 (largest)
Range: 150 units difference
```

**After:**
```
PROD-001, week 1: 250
PROD-002, week 2: 250
Range: 0 units difference (all equal!)
```

**Complete redistribution!** No relationship to previous values.

### Understanding COUNT(*) OVER ()

**Window Function for Counting:**

```sql
SELECT
    product_id,
    week,
    COUNT(*) OVER () as total_rows
FROM kpi_data
WHERE dept = 'Electronics'
```

**Result:**
```
product_id | week | total_rows
-----------|------|------------
PROD-001   | 1    | 8          ← Same count for every row
PROD-001   | 2    | 8          ← Same count for every row
PROD-002   | 1    | 8          ← Same count for every row
...
```

Each row knows the total count without collapsing the result set.

### Python Implementation

```python
def generate_equal_sql(
    kpi_column: str,
    granularity: List[str],
    where_clause: str,
    database: str,
    table: str,
    new_value: float
) -> str:
    """
    Generate equal distribution SQL using window functions.

    Args:
        kpi_column: Column to update (e.g., "sls_u")
        granularity: Unique key columns (e.g., ["product_id", "week", "year"])
        where_clause: Filter (e.g., "dept = 'Electronics' AND week BETWEEN 1 AND 4")
        database: Database name
        table: Table name
        new_value: Target total value

    Returns:
        SQL ALTER TABLE UPDATE statement
    """

    # Build correlation conditions for subquery
    correlation_conditions = " AND ".join([
        f"source.{col} = target.{col}" for col in granularity
    ])

    sql = f"""
    ALTER TABLE {database}.{table} AS target
    UPDATE {kpi_column} = (
        SELECT {new_value} / COUNT(*) OVER ()
        FROM {database}.{table} AS source
        WHERE {correlation_conditions}
    )
    WHERE {where_clause}
    """

    return sql.strip()
```

**Example Usage:**
```python
sql = generate_equal_sql(
    kpi_column="sls_u",
    granularity=["product_id", "week", "year"],
    where_clause="dept = 'Electronics' AND week BETWEEN 1 AND 4 AND year = 2024",
    database="spanx_kpi_data",
    table="kpi_data",
    new_value=2000
)

print(sql)
```

### When to Use Equal Distribution

**✅ Good For:**
- New product launches (no history to preserve)
- Resetting unfair distributions
- All current values are zero
- Test/demo scenarios

**Example Scenarios:**
- New product line launch → use equal (no existing pattern)
- Correcting skewed inventory → use equal (reset fairly)
- Initial data load → use equal (start from scratch)

**❌ Avoid When:**
- Products have different demand levels
- Current distribution reflects reality
- Need to respect market patterns

---

## 🔄 Side-by-Side Comparison

### Same Data, Two Strategies

**Initial State:**
```
product_id | week | current_sls_u
-----------|------|---------------
PROD-001   | 1    | 100
PROD-001   | 2    | 300
PROD-002   | 1    | 400
PROD-002   | 2    | 200
                    ────
             Total: 1000
```

**Target:** 2000 units

**Pro-Rata Result:**
```
product_id | week | weight  | new_value | change
-----------|------|---------|-----------|--------
PROD-001   | 1    | 0.10    | 200       | +100
PROD-001   | 2    | 0.30    | 600       | +300
PROD-002   | 1    | 0.40    | 800       | +400
PROD-002   | 2    | 0.20    | 400       | +200
                             ────
                      Total: 2000
```

**Analysis:**
- PROD-001, week 1: Had 10% → still has 10% (200/2000)
- PROD-002, week 1: Had 40% → still has 40% (800/2000)
- All values doubled (1000 → 2000 is 2x)

**Equal Result:**
```
product_id | week | new_value | change
-----------|------|-----------|--------
PROD-001   | 1    | 500       | +400 🔥
PROD-001   | 2    | 500       | +200
PROD-002   | 1    | 500       | +100
PROD-002   | 2    | 500       | +300 🔥
                   ────
            Total: 2000
```

**Analysis:**
- PROD-001, week 1: Was smallest (100), biggest increase (+400)
- PROD-002, week 1: Was largest (400), smallest increase (+100)
- All end up at same value (500)

### Visual Comparison

```
BEFORE:
  PROD-001 wk1: ▓░░░░░░░░░ (100)
  PROD-001 wk2: ▓▓▓░░░░░░░ (300)
  PROD-002 wk1: ▓▓▓▓░░░░░░ (400)
  PROD-002 wk2: ▓▓░░░░░░░░ (200)

PRO-RATA AFTER (preserves shape):
  PROD-001 wk1: ▓▓░░░░░░░░ (200)   ← Still smallest
  PROD-001 wk2: ▓▓▓▓▓▓░░░░ (600)   ← Still large
  PROD-002 wk1: ▓▓▓▓▓▓▓▓░░ (800)   ← Still largest
  PROD-002 wk2: ▓▓▓▓░░░░░░ (400)   ← Still small

EQUAL AFTER (flattens everything):
  PROD-001 wk1: ▓▓▓▓▓░░░░░ (500)   ← Same as all
  PROD-001 wk2: ▓▓▓▓▓░░░░░ (500)   ← Same as all
  PROD-002 wk1: ▓▓▓▓▓░░░░░ (500)   ← Same as all
  PROD-002 wk2: ▓▓▓▓▓░░░░░ (500)   ← Same as all
```

---

## 🔧 Complete Workflow Example

### Scenario: User Edits Aggregated KPI

**Payload:**
```json
{
  "kpi": "Sls U",
  "new_value": 50000,
  "dept": "Electronics",
  "subdept": "TVs",
  "time_level": "month",
  "time_value": 1,
  "year": 2024
}
```

**Config:**
```json
{
  "name": "Sls U",
  "allocation_strategy": {
    "default": {
      "strategy": "pro_rata"
    }
  }
}
```

### Workflow Generator Logic

```python
def generate_aggregated_workflow(payload, config):
    """
    Generate workflow for aggregated edit.
    """

    # 1. Build WHERE clause from payload
    where_clause = build_where_clause(payload, config)
    # Result: "dept = 'Electronics' AND subdept = 'TVs'
    #          AND toMonth(toDate(year, 1, 1) + toIntervalWeek(week)) = 1
    #          AND year = 2024"

    # 2. Get allocation strategy
    strategy = config.kpis["Sls U"].allocation_strategy.default.strategy
    # Result: "pro_rata"

    # 3. Generate allocation SQL
    if strategy == "pro_rata":
        allocation_sql = generate_pro_rata_sql(
            kpi_column="sls_u",
            granularity=config.granularity,
            where_clause=where_clause,
            database=config.database,
            table=config.data_table,
            new_value=payload["new_value"]
        )
    elif strategy == "equal":
        allocation_sql = generate_equal_sql(
            kpi_column="sls_u",
            granularity=config.granularity,
            where_clause=where_clause,
            database=config.database,
            table=config.data_table,
            new_value=payload["new_value"]
        )

    # 4. Build workflow
    workflow = {
        "workflow_id": generate_id(),
        "steps": [
            {
                "step_id": "step_1_allocate_sls_u",
                "description": f"Allocate Sls U using {strategy} strategy",
                "sql": allocation_sql,
                "dependencies": [],
                "cleanup": False
            }
            # ... add dependent KPI recalculation steps
        ],
        "metadata": {
            "edit_type": "aggregated",
            "allocation_strategy": strategy
        }
    }

    return workflow
```

### Generated SQL (Pro-Rata)

```sql
ALTER TABLE spanx_kpi_data.kpi_data AS target
UPDATE sls_u = (
    SELECT
        50000 * (sls_u / SUM(sls_u) OVER ())
    FROM spanx_kpi_data.kpi_data AS source
    WHERE source.product_id = target.product_id
      AND source.week = target.week
      AND source.year = target.year
)
WHERE dept = 'Electronics'
  AND subdept = 'TVs'
  AND toMonth(toDate(year, 1, 1) + toIntervalWeek(week)) = 1
  AND year = 2024
```

### Generated SQL (Equal)

```sql
ALTER TABLE spanx_kpi_data.kpi_data AS target
UPDATE sls_u = (
    SELECT 50000 / COUNT(*) OVER ()
    FROM spanx_kpi_data.kpi_data AS source
    WHERE source.product_id = target.product_id
      AND source.week = target.week
      AND source.year = target.year
)
WHERE dept = 'Electronics'
  AND subdept = 'TVs'
  AND toMonth(toDate(year, 1, 1) + toIntervalWeek(week)) = 1
  AND year = 2024
```

---

## 📊 Performance Characteristics

### Window Functions are Fast

**Why `OVER ()` performs well:**

1. **Single Table Scan:** Window function processes data in one pass
2. **ClickHouse Optimization:** ClickHouse is designed for window functions
3. **No Self-Joins:** Correlated subquery approach would require joins

**Benchmark (200 rows):**
```
Window function approach: ~15ms
Subquery approach:        ~150ms
```

### Execution Plan

**Window Function Approach:**
```
1. Scan table with WHERE filter (200 rows)
2. Compute window function (SUM/COUNT)
3. Calculate new values
4. Update rows
→ One pass through filtered data
```

**Alternative Subquery Approach (Slower):**
```sql
-- DON'T DO THIS
UPDATE kpi_data
SET sls_u = sls_u / (
    SELECT SUM(sls_u) FROM kpi_data WHERE dept = 'Electronics'
) * 50000
WHERE dept = 'Electronics'

→ Subquery runs for EVERY row (N executions)
```

---

## 🎯 Decision Guide

### When to Use Each Strategy

```
┌─────────────────────────────────────────────┐
│ Is the current distribution representative? │
└─────────────────┬───────────────────────────┘
                  │
        ┌─────────┴─────────┐
       YES                  NO
        │                    │
        ↓                    ↓
   Use PRO-RATA          Use EQUAL
   (preserve mix)        (reset fair)
```

### Configuration

**Pro-Rata (Default):**
```json
{
  "name": "Sls U",
  "allocation_strategy": {
    "default": {
      "strategy": "pro_rata"
    }
  }
}
```

**Equal Distribution:**
```json
{
  "name": "Sls U",
  "allocation_strategy": {
    "default": {
      "strategy": "equal"
    }
  }
}
```

---

## ⚙️ Config-Driven Architecture

### Strategy Resolution

Allocation strategies are resolved at runtime from client configuration. No hardcoded strategy selection in application code.

```
allocation_strategy = resolve_from_config(kpi_name, client_id)
```

### Configuration Schema

**File:** `configs/{client_id}/kpi_config.json`

```json
{
  "client_id": "spanx",
  "database": "spanx_kpi_data",
  "data_table": "kpi_data",
  "granularity": ["product_id", "week", "year"],

  "kpis": [
    {
      "name": "Sls U",
      "display_name": "Sales Units",
      "is_editable": true,
      "handler_type": "linear",
      "formula": null,
      "depends_on": [],
      "locks_when_edited": ["DR%", "Return %"],
      "allocation_strategy": {
        "default": {
          "strategy": "pro_rata"
        }
      }
    },
    {
      "name": "COGS",
      "display_name": "Cost of Goods Sold",
      "is_editable": false,
      "handler_type": "linear",
      "formula": "Sls U * AUC",
      "depends_on": ["Sls U", "AUC"],
      "locks_when_edited": []
    },
    {
      "name": "New Product Forecast",
      "display_name": "New Product Forecast",
      "is_editable": true,
      "handler_type": "linear",
      "formula": null,
      "depends_on": [],
      "locks_when_edited": [],
      "allocation_strategy": {
        "default": {
          "strategy": "equal"
        }
      }
    }
  ]
}
```

### Strategy Lookup Algorithm

```python
def generate_aggregated_workflow(payload: dict, client_config: dict):
    # Extract KPI identifier
    kpi_name = payload["kpi"]

    # Resolve KPI config
    kpi_config = lookup_kpi_config(client_config["kpis"], kpi_name)
    if not kpi_config:
        raise ConfigError(f"KPI '{kpi_name}' not found")

    # Resolve strategy with fallback chain
    strategy = kpi_config
                .get("allocation_strategy", {})
                .get("default", {})
                .get("strategy", "pro_rata")

    # Generate WHERE clause from payload filters
    where_clause = build_where_clause(payload, client_config)

    # Dispatch to strategy-specific SQL generator
    sql_generators = {
        "pro_rata": generate_pro_rata_sql,
        "equal": generate_equal_sql
    }

    if strategy not in sql_generators:
        raise StrategyError(f"Unknown strategy: {strategy}")

    allocation_sql = sql_generators[strategy](
        kpi_column=normalize_kpi_name(kpi_name),
        granularity=client_config["granularity"],
        where_clause=where_clause,
        database=client_config["database"],
        table=client_config["data_table"],
        new_value=payload["new_value"]
    )

    # Construct workflow DAG
    return {
        "workflow_id": generate_id(),
        "client_id": client_config["client_id"],
        "steps": [{
            "step_id": "allocate",
            "sql": allocation_sql,
            "dependencies": []
        }],
        "metadata": {
            "strategy": strategy,
            "kpi": kpi_name
        }
    }
```

### Execution Trace

**Input:**
```json
{"kpi": "Sls U", "new_value": 50000, "dept": "Electronics", "time_level": "month", "time_value": 1, "year": 2024}
```

**Resolution:**
```
lookup_kpi("Sls U") → config.allocation_strategy.default.strategy → "pro_rata"
```

**Generated SQL:**
```sql
ALTER TABLE spanx_kpi_data.kpi_data AS target
UPDATE sls_u = (SELECT 50000 * (sls_u / SUM(sls_u) OVER ()) FROM ... WHERE ...)
WHERE dept = 'Electronics' AND toMonth(...) = 1 AND year = 2024
```

**Input:**
```json
{"kpi": "New Product Forecast", "new_value": 10000, "dept": "Apparel", "time_level": "quarter", "time_value": 1, "year": 2024}
```

**Resolution:**
```
lookup_kpi("New Product Forecast") → config.allocation_strategy.default.strategy → "equal"
```

**Generated SQL:**
```sql
ALTER TABLE spanx_kpi_data.kpi_data AS target
UPDATE new_product_forecast = (SELECT 10000 / COUNT(*) OVER () FROM ... WHERE ...)
WHERE dept = 'Apparel' AND toQuarter(...) = 1 AND year = 2024
```

### Strategy Mapping Table

```
KPI                  | allocation_strategy.default.strategy
---------------------|-------------------------------------
Sls U                | pro_rata
Target Inventory     | equal
Promo Units          | pro_rata
```

### Multi-Tenant Configuration

Same KPI identifier resolves to different strategies per client:

```
client_id: spanx
  kpi: "Sls U" → strategy: "pro_rata"

client_id: newbrand
  kpi: "Sls U" → strategy: "equal"
```

### Config Resolution

```python
@lru_cache(maxsize=1)
def load_client_config() -> dict:
    client_id = os.getenv("CLIENT_ID")
    if not client_id:
        raise ConfigError("CLIENT_ID not set")

    config_path = f"configs/{client_id}/kpi_config.json"
    return json.load(open(config_path))
```

```bash
export CLIENT_ID=spanx
uvicorn app.main:app
# → loads configs/spanx/kpi_config.json
```

### Fallback Chain

```python
strategy = (kpi_config
            .get("allocation_strategy", {})
            .get("default", {})
            .get("strategy", "pro_rata"))  # fallback
```

Missing config → defaults to `pro_rata`

### Runtime Strategy Modification

```
Config change:
  allocation_strategy.default.strategy: "pro_rata" → "equal"

Next request:
  resolve_strategy() → "equal"

No code deployment required.
```

---

## Summary

### Allocation Strategies

```
pro_rata:
  formula: new = target × (current / sum)
  SQL: target * (value / SUM(value) OVER ())
  behavior: preserves proportions

equal:
  formula: new = target / count
  SQL: target / COUNT(*) OVER ()
  behavior: uniform distribution
```

### Architecture

```
Strategy resolution:
  per-KPI configuration
  client-specific overrides
  runtime config loading

Execution path:
  payload → load_config(client_id) → resolve_strategy(kpi) → generate_sql(strategy) → execute

Window function approach:
  single pass over filtered data
  no GROUP BY required
  maintains row-level granularity
```
