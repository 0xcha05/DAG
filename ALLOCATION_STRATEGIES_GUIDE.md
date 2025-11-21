# Allocation Strategies Guide

A comprehensive guide to understanding and choosing allocation strategies for aggregated KPI edits in the KPI Rebalancing Engine.

---

## 📖 What is Allocation?

### The Problem

When a user edits a KPI at an **aggregated level**, the system must distribute (allocate) that value across multiple **granular rows**.

**Example:**
- **User says:** "Electronics department, January 2024 → 50,000 units total"
- **System must:** Distribute 50,000 units across 200 individual product-week rows
- **Question:** How much should each product-week get?

### Storage vs Edit Levels

```
EDIT LEVEL (Aggregated):
┌─────────────────────────────────┐
│ Electronics, January 2024       │
│ Target: 50,000 units            │
└─────────────────────────────────┘
           ↓ (Allocation)

STORAGE LEVEL (Granular):
┌────────────┬──────┬──────┬───────┐
│ product_id │ week │ year │ sls_u │
├────────────┼──────┼──────┼───────┤
│ PROD-001   │ 1    │ 2024 │ ???   │
│ PROD-001   │ 2    │ 2024 │ ???   │
│ PROD-001   │ 3    │ 2024 │ ???   │
│ PROD-001   │ 4    │ 2024 │ ???   │
│ PROD-002   │ 1    │ 2024 │ ???   │
│ PROD-002   │ 2    │ 2024 │ ???   │
│ ...        │ ...  │ ...  │ ...   │
│ PROD-050   │ 4    │ 2024 │ ???   │
└────────────┴──────┴──────┴───────┘
200 rows need values!
```

**Allocation strategies answer:** How do we split 50,000 units across 200 rows?

---

## 🎯 The Four Strategies

| Strategy | When to Use | Complexity | Use Case |
|----------|------------|------------|----------|
| **Pro-Rata** | Default choice | Simple | Maintain current proportions |
| **Equal** | Fair distribution | Simple | New products, reset scenarios |
| **Historical** | Seasonal products | Medium | Leverage past patterns |
| **Weighted** | Priority-based | Medium | A/B/C tier products |

---

## 1️⃣ Pro-Rata (Proportional)

### Concept

"Give more to those who already have more."

Each row gets a share **proportional to its current value**.

### Formula

```
weight(row) = current_value(row) / SUM(current_values)
new_value(row) = target_total * weight(row)
```

### Example

**Current State:**
```
product_id | week | current_sls_u | proportion
-----------|------|---------------|------------
PROD-001   | 1    | 100           | 10%
PROD-001   | 2    | 150           | 15%
PROD-002   | 1    | 200           | 20%
PROD-002   | 2    | 250           | 25%
PROD-003   | 1    | 150           | 15%
PROD-003   | 2    | 150           | 15%
                    ─────
                    1000 (current total)
```

**User Edit:** Change total to 2000 units

**Distribution:**
```
product_id | week | weight | calculation       | new_value
-----------|------|--------|-------------------|----------
PROD-001   | 1    | 0.10   | 2000 * 0.10       | 200
PROD-001   | 2    | 0.15   | 2000 * 0.15       | 300
PROD-002   | 1    | 0.20   | 2000 * 0.20       | 400
PROD-002   | 2    | 0.25   | 2000 * 0.25       | 500
PROD-003   | 1    | 0.15   | 2000 * 0.15       | 300
PROD-003   | 2    | 0.15   | 2000 * 0.15       | 300
                                      ─────
                                      2000 ✓
```

**Key Insight:** PROD-002, week 2 had 25% before → still has 25% after!

### SQL Implementation

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

### When to Use

✅ **Good for:**
- Maintaining existing distribution patterns
- Scaling up or down while preserving relative importance
- Products with established sales patterns

❌ **Avoid when:**
- Current values are all zero (division by zero!)
- Current distribution is broken/unfair
- Starting fresh with new products

### Configuration

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

### Pros & Cons

**Pros:**
- ✅ Preserves existing patterns
- ✅ Simple to understand
- ✅ Fast computation

**Cons:**
- ⚠️ "Rich get richer" - high performers get more
- ⚠️ Doesn't correct past mistakes
- ⚠️ Fails with zero values

---

## 2️⃣ Equal Distribution

### Concept

"Everyone gets the same amount."

Split the total evenly across all rows, regardless of current values.

### Formula

```
weight(row) = 1 / COUNT(rows)
new_value(row) = target_total / COUNT(rows)
```

### Example

**Current State:**
```
product_id | week | current_sls_u
-----------|------|---------------
PROD-001   | 1    | 50
PROD-001   | 2    | 300
PROD-002   | 1    | 400
PROD-002   | 2    | 100
                    ────
                    850 (current total)
```

**User Edit:** Change total to 1200 units

**Distribution:**
```
product_id | week | calculation   | new_value
-----------|------|---------------|----------
PROD-001   | 1    | 1200 / 4      | 300
PROD-001   | 2    | 1200 / 4      | 300
PROD-002   | 1    | 1200 / 4      | 300
PROD-002   | 2    | 1200 / 4      | 300
                                    ────
                                    1200 ✓
```

**Key Insight:** All rows get 300, regardless of what they had before!

### SQL Implementation

```sql
ALTER TABLE kpi_data AS target
UPDATE sls_u = (
    SELECT 1200 / COUNT(*) OVER ()
    FROM kpi_data AS source
    WHERE source.product_id = target.product_id
      AND source.week = target.week
      AND source.year = target.year
)
WHERE dept = 'Electronics'
  AND week BETWEEN 1 AND 4
  AND year = 2024
```

### When to Use

✅ **Good for:**
- New product launches (no history)
- Resetting unfair distributions
- Test scenarios
- When all current values are zero

❌ **Avoid when:**
- Products have different capacities/demand
- Historical patterns should be respected
- Some products are higher priority

### Configuration

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

### Pros & Cons

**Pros:**
- ✅ Fair and unbiased
- ✅ Works when current values are zero
- ✅ Simple to explain to business users

**Cons:**
- ⚠️ Ignores product differences
- ⚠️ May create unrealistic values
- ⚠️ Doesn't leverage historical data

---

## 3️⃣ Historical (Seasonal)

### Concept

"Use past patterns to predict distribution."

Allocate based on average values from previous years during the same time period.

### Formula

```
historical_avg(row) = AVG(values from past N years, same time period)
weight(row) = historical_avg(row) / SUM(historical_avgs)
new_value(row) = target_total * weight(row)
```

### Example

**Historical Data (2022-2023 for January):**
```
product_id | week | 2022 | 2023 | historical_avg
-----------|------|------|------|----------------
PROD-001   | 1    | 80   | 90   | 85
PROD-001   | 2    | 120  | 130  | 125
PROD-001   | 3    | 100  | 110  | 105
PROD-001   | 4    | 110  | 120  | 115
                                  ────
                                  430 (sum of avgs)
```

**User Edit:** January 2024 → 2000 units

**Distribution:**
```
product_id | week | hist_avg | weight     | calculation   | new_value
-----------|------|----------|------------|---------------|----------
PROD-001   | 1    | 85       | 85/430     | 2000 * 0.198  | 395
PROD-001   | 2    | 125      | 125/430    | 2000 * 0.291  | 581
PROD-001   | 3    | 105      | 105/430    | 2000 * 0.244  | 488
PROD-001   | 4    | 115      | 115/430    | 2000 * 0.267  | 535
                                                            ────
                                                            1999 ✓
```

**Key Insight:** Week 2 gets more because it historically had higher sales!

### SQL Implementation

```sql
WITH historical_avg AS (
    SELECT
        product_id,
        week,
        AVG(sls_u) as avg_value
    FROM kpi_data
    WHERE year BETWEEN 2022 AND 2023
      AND week BETWEEN 1 AND 4
    GROUP BY product_id, week
)
ALTER TABLE kpi_data AS target
UPDATE sls_u = (
    SELECT
        2000 * (h.avg_value / SUM(h.avg_value) OVER ())
    FROM historical_avg h
    WHERE h.product_id = target.product_id
      AND h.week = target.week
)
WHERE dept = 'Electronics'
  AND week BETWEEN 1 AND 4
  AND year = 2024
```

### When to Use

✅ **Good for:**
- Seasonal products (winter coats, swimwear, holiday items)
- Established products with stable patterns
- Annual planning based on history
- When current year data is incomplete/unreliable

❌ **Avoid when:**
- New products (no history)
- Market has changed drastically
- Historical data unavailable
- Business model pivot

### Configuration

```json
{
  "name": "Sls U",
  "allocation_strategy": {
    "default": {
      "strategy": "historical",
      "lookback_years": 2,
      "same_time_period": true
    },
    "time": {
      "year": {
        "strategy": "historical",
        "lookback_years": 3
      }
    }
  }
}
```

### Pros & Cons

**Pros:**
- ✅ Respects seasonality
- ✅ Leverages data science
- ✅ More accurate for forecasting

**Cons:**
- ⚠️ Requires historical data
- ⚠️ Assumes past predicts future
- ⚠️ More complex to compute

---

## 4️⃣ Weighted (Tier-Based)

### Concept

"Prioritize based on product importance."

Products are grouped into tiers (A/B/C, Platinum/Gold/Silver) and higher tiers get proportionally more.

### Formula

```
tier_weight(row) = weight assigned to row's tier
weight(row) = tier_weight(row) / SUM(tier_weights)
new_value(row) = target_total * weight(row)
```

### Example

**Current State:**
```
product_id | tier | week | current_sls_u
-----------|------|------|---------------
PROD-001   | A    | 1    | 100
PROD-002   | A    | 1    | 100
PROD-003   | B    | 1    | 100
PROD-004   | B    | 1    | 100
PROD-005   | C    | 1    | 100
PROD-006   | C    | 1    | 100
```

**Tier Weights:**
- A tier: 3.0
- B tier: 2.0
- C tier: 1.0

**User Edit:** Week 1 → 1200 units

**Distribution:**
```
product_id | tier | tier_weight | weight        | calculation   | new_value
-----------|------|-------------|---------------|---------------|----------
PROD-001   | A    | 3.0         | 3/12 = 0.25   | 1200 * 0.25   | 300
PROD-002   | A    | 3.0         | 3/12 = 0.25   | 1200 * 0.25   | 300
PROD-003   | B    | 2.0         | 2/12 = 0.167  | 1200 * 0.167  | 200
PROD-004   | B    | 2.0         | 2/12 = 0.167  | 1200 * 0.167  | 200
PROD-005   | C    | 1.0         | 1/12 = 0.083  | 1200 * 0.083  | 100
PROD-006   | C    | 1.0         | 1/12 = 0.083  | 1200 * 0.083  | 100
                    ────                                          ────
                    12                                            1200 ✓
```

**Key Insight:** A-tier products get 3x more than C-tier (300 vs 100)

### SQL Implementation

```sql
ALTER TABLE kpi_data AS target
UPDATE sls_u = (
    SELECT
        1200 * (
            CASE
                WHEN product_tier = 'A' THEN 3.0
                WHEN product_tier = 'B' THEN 2.0
                WHEN product_tier = 'C' THEN 1.0
                ELSE 1.0
            END / SUM(
                CASE
                    WHEN product_tier = 'A' THEN 3.0
                    WHEN product_tier = 'B' THEN 2.0
                    WHEN product_tier = 'C' THEN 1.0
                    ELSE 1.0
                END
            ) OVER ()
        )
    FROM kpi_data AS source
    WHERE source.product_id = target.product_id
      AND source.week = target.week
      AND source.year = target.year
)
WHERE week = 1 AND year = 2024
```

### When to Use

✅ **Good for:**
- Products with clear priority levels
- Inventory allocation (premium products first)
- Limited capacity scenarios
- Strategic product focus

❌ **Avoid when:**
- All products equal priority
- Tier data unavailable/outdated
- Need to reflect actual demand

### Configuration

```json
{
  "name": "Sls U",
  "allocation_strategy": {
    "default": {
      "strategy": "weighted",
      "tier_column": "product_tier",
      "tier_weights": {
        "A": 3.0,
        "B": 2.0,
        "C": 1.0
      }
    }
  }
}
```

### Pros & Cons

**Pros:**
- ✅ Aligns with business strategy
- ✅ Flexible (custom weights)
- ✅ Controls distribution

**Cons:**
- ⚠️ Requires tier classification
- ⚠️ May ignore actual demand
- ⚠️ Tier weights subjective

---

## 🔀 Strategy Comparison

### Real-World Scenario

**Setup:**
- 6 products, 1 week
- Current total: 600 units
- Target total: 1200 units (2x increase)

**Current State:**
```
product_id | tier | current | historical_avg (last 2 years)
-----------|------|---------|-------------------------------
PROD-001   | A    | 200     | 180
PROD-002   | A    | 150     | 160
PROD-003   | B    | 100     | 120
PROD-004   | B    | 80      | 100
PROD-005   | C    | 50      | 80
PROD-006   | C    | 20      | 60
           Total: 600       700
```

**Results by Strategy:**

| Product | Tier | Current | Pro-Rata | Equal | Historical | Weighted |
|---------|------|---------|----------|-------|------------|----------|
| PROD-001 | A   | 200     | **400**  | 200   | 309        | 300      |
| PROD-002 | A   | 150     | **300**  | 200   | 274        | 300      |
| PROD-003 | B   | 100     | **200**  | 200   | 206        | 200      |
| PROD-004 | B   | 80      | **160**  | 200   | 171        | 200      |
| PROD-005 | C   | 50      | **100**  | 200   | 137        | 100      |
| PROD-006 | C   | 20      | **40**   | 200   | 103        | 100      |
| **Total** |    | 600     | **1200** | 1200  | 1200       | 1200     |

**Observations:**

1. **Pro-Rata:** Doubles everything (600 → 1200)
   - PROD-001 keeps 33% share (400/1200 = 200/600)
   - PROD-006 still smallest at 40

2. **Equal:** Radical redistribution
   - PROD-006 goes from 20 → 200 (10x!)
   - PROD-001 only 2x (200 → 200)
   - Fair but ignores reality

3. **Historical:** Pattern-based
   - PROD-001 gets 309 (was 180 historically)
   - Respects seasonal trends
   - More balanced than pro-rata

4. **Weighted:** Strategy-driven
   - A-tier: 300 each (high priority)
   - C-tier: 100 each (low priority)
   - Aligns with business goals

---

## 🎛️ Choosing the Right Strategy

### Decision Tree

```
Is this a new product with no history?
├─ YES → Use EQUAL
└─ NO ↓

Is the current distribution fair and representative?
├─ YES → Use PRO-RATA
└─ NO ↓

Do you have reliable historical data?
├─ YES ↓
│   Is seasonality important?
│   ├─ YES → Use HISTORICAL
│   └─ NO → Use PRO-RATA or WEIGHTED
└─ NO ↓

Do products have clear priority tiers?
├─ YES → Use WEIGHTED
└─ NO → Use EQUAL or PRO-RATA
```

### By Business Scenario

| Scenario | Recommended Strategy | Reason |
|----------|---------------------|---------|
| **Seasonal forecasting** | Historical | Respects annual patterns |
| **Inventory planning** | Weighted | Prioritize high-value items |
| **New product launch** | Equal | No history to bias |
| **Scaling up sales** | Pro-Rata | Maintain current mix |
| **Budget allocation** | Weighted | Strategic priorities |
| **Reset/rebalance** | Equal | Start fresh |

### By Time Aggregation Level

```json
{
  "allocation_strategy": {
    "default": {
      "strategy": "pro_rata"
    },
    "time": {
      "year": {
        "strategy": "historical",
        "lookback_years": 3
      },
      "quarter": {
        "strategy": "historical",
        "lookback_years": 2
      },
      "month": {
        "strategy": "pro_rata"
      },
      "week": {
        "strategy": "equal"
      }
    }
  }
}
```

**Rationale:**
- **Year edits:** Use 3-year historical (long-term patterns)
- **Quarter edits:** Use 2-year historical (seasonal)
- **Month edits:** Use pro-rata (current patterns)
- **Week edits:** Use equal (too granular for weighting)

---

## ⚠️ Edge Cases & Solutions

### Edge Case 1: Division by Zero (Pro-Rata)

**Problem:**
```
All current values are zero
SUM(current_values) = 0
weight = value / 0  ❌ Division by zero!
```

**Solution 1: Auto-fallback**
```python
def get_allocation_strategy(kpi_config, current_sum):
    strategy = kpi_config.allocation_strategy.default.strategy

    if strategy == "pro_rata" and current_sum == 0:
        # Fallback to equal distribution
        strategy = "equal"
        logger.warning(f"Pro-rata allocation not possible (sum=0), using equal distribution")

    return strategy
```

**Solution 2: Explicit error**
```python
if strategy == "pro_rata" and current_sum == 0:
    raise ValueError(
        "Cannot use pro-rata allocation when all current values are zero. "
        "Please use 'equal' strategy or provide non-zero baseline values."
    )
```

### Edge Case 2: No Historical Data

**Problem:**
```sql
SELECT AVG(sls_u) FROM kpi_data
WHERE year BETWEEN 2022 AND 2023
-- Returns no rows! New product launched in 2024
```

**Solution: Fallback chain**
```json
{
  "allocation_strategy": {
    "default": {
      "strategy": "historical",
      "lookback_years": 2,
      "fallback_strategy": "equal"
    }
  }
}
```

```python
historical_data = fetch_historical_avg(...)
if historical_data.empty:
    logger.warning("No historical data found, using fallback strategy")
    return generate_equal_sql(...)
```

### Edge Case 3: Partial Historical Data

**Problem:**
```
PROD-001: Has 2 years of data ✓
PROD-002: Launched mid-2023 (only 1 year) ⚠️
PROD-003: Launched 2024 (no history) ❌
```

**Solution: Hybrid approach**
```python
def generate_hybrid_historical_sql(...):
    """
    Products with history: Use historical weights
    Products without history: Split remainder equally
    """

    products_with_history = [...]
    products_without_history = [...]

    # Allocate 80% to historical products
    historical_portion = target_value * 0.8

    # Allocate 20% equally to new products
    new_product_portion = target_value * 0.2
```

### Edge Case 4: Single Row Match

**Problem:**
```
Filter matches only 1 row
All strategies reduce to: new_value = target_value
```

**Solution: Skip allocation**
```python
affected_rows = execute_query(f"SELECT COUNT(*) FROM ... WHERE {where_clause}")

if affected_rows == 1:
    # Direct UPDATE, no allocation needed
    return generate_direct_update_sql(...)
```

### Edge Case 5: Negative Values

**Problem:**
```
Some products have negative current values (returns, adjustments)
weight = -100 / 500 = -0.2  (negative weight!)
```

**Solution: Absolute value or filter**
```python
# Option 1: Use absolute values
weight = ABS(current_value) / SUM(ABS(current_value))

# Option 2: Filter negatives
WHERE current_value > 0
```

---

## 📊 Performance Considerations

### Window Functions vs Subqueries

**✅ Window Functions (Recommended):**
```sql
SELECT
    product_id,
    week,
    sls_u / SUM(sls_u) OVER () as weight
FROM kpi_data
WHERE dept = 'Electronics'
```

**Pros:**
- Single table scan
- ClickHouse optimized
- Maintains row context

**❌ Subquery Approach:**
```sql
SELECT
    product_id,
    week,
    sls_u / (SELECT SUM(sls_u) FROM kpi_data WHERE dept = 'Electronics') as weight
FROM kpi_data
WHERE dept = 'Electronics'
```

**Cons:**
- Correlated subquery (slow)
- Multiple scans
- Less efficient

### Large Aggregations

**Problem:** Editing "All products, All weeks, 2024" → 50,000+ rows

**Optimization:**
```sql
-- Add index on filter columns
CREATE INDEX idx_dept_year ON kpi_data (dept, year);

-- Partition by year
ALTER TABLE kpi_data
PARTITION BY year;

-- Use PREWHERE for filters (ClickHouse specific)
SELECT ...
FROM kpi_data
PREWHERE year = 2024 AND dept = 'Electronics'
WHERE ...
```

---

## 🧪 Testing Allocation Strategies

### Unit Test Template

```python
def test_pro_rata_allocation():
    """Test pro-rata allocation preserves proportions."""

    # Setup
    current_data = [
        {"product_id": "P1", "week": 1, "sls_u": 100},
        {"product_id": "P2", "week": 1, "sls_u": 200},
        {"product_id": "P3", "week": 1, "sls_u": 300},
    ]
    current_sum = 600
    target_value = 1200

    # Execute
    sql = generate_pro_rata_sql(
        kpi_column="sls_u",
        granularity=["product_id", "week", "year"],
        where_clause="week = 1 AND year = 2024",
        database="test_db",
        table="kpi_data",
        new_value=target_value
    )

    result = execute_sql(sql)

    # Verify
    assert sum([r["sls_u"] for r in result]) == 1200
    assert result[0]["sls_u"] == 200  # P1: 100/600 * 1200 = 200
    assert result[1]["sls_u"] == 400  # P2: 200/600 * 1200 = 400
    assert result[2]["sls_u"] == 600  # P3: 300/600 * 1200 = 600

    # Verify proportions maintained
    assert result[0]["sls_u"] / 1200 == pytest.approx(100 / 600)
```

### Integration Test

```python
def test_allocation_end_to_end():
    """Test allocation in full workflow."""

    payload = {
        "kpi": "Sls U",
        "new_value": 50000,
        "dept": "Electronics",
        "time_level": "month",
        "time_value": 1,
        "year": 2024
    }

    workflow = generate_workflow(payload)

    # Verify allocation step exists
    allocation_step = workflow["steps"][0]
    assert "pro_rata" in allocation_step["description"].lower()
    assert "SUM(sls_u) OVER ()" in allocation_step["sql"]

    # Execute workflow
    execute_workflow(workflow)

    # Verify result
    new_sum = db.execute(
        "SELECT SUM(sls_u) FROM kpi_data "
        "WHERE dept = 'Electronics' AND month = 1 AND year = 2024"
    )
    assert new_sum == 50000
```

---

## 📚 Best Practices

### 1. Document Strategy Choice

```json
{
  "name": "Sls U",
  "allocation_strategy": {
    "default": {
      "strategy": "pro_rata",
      "rationale": "Maintains current product mix for short-term edits"
    },
    "time": {
      "year": {
        "strategy": "historical",
        "lookback_years": 3,
        "rationale": "Annual planning uses 3-year seasonal average"
      }
    }
  }
}
```

### 2. Provide Fallbacks

```json
{
  "default": {
    "strategy": "pro_rata",
    "fallback_strategy": "equal",
    "fallback_condition": "sum_equals_zero"
  }
}
```

### 3. Log Allocation Details

```python
logger.info(f"Allocation: {strategy} strategy")
logger.info(f"Target value: {target_value}")
logger.info(f"Affected rows: {row_count}")
logger.info(f"Current sum: {current_sum}")
logger.info(f"Delta: {target_value - current_sum}")
```

### 4. Validate Results

```python
# After allocation, verify sum
actual_sum = db.execute(f"SELECT SUM({kpi_column}) FROM ... WHERE {where_clause}")
expected_sum = target_value

if abs(actual_sum - expected_sum) > 0.01:  # Allow rounding
    raise ValueError(f"Allocation mismatch: expected {expected_sum}, got {actual_sum}")
```

### 5. User Communication

Include in workflow response:
```json
{
  "metadata": {
    "allocation_info": {
      "strategy": "pro_rata",
      "affected_rows": 200,
      "current_sum": 38500,
      "target_sum": 50000,
      "delta": 11500,
      "per_row_avg_change": 57.5
    }
  }
}
```

---

## 🎓 Summary

### Quick Reference

| Need | Use | Why |
|------|-----|-----|
| Preserve current mix | **Pro-Rata** | Maintains proportions |
| New products | **Equal** | No bias |
| Seasonal planning | **Historical** | Leverages patterns |
| Strategic priority | **Weighted** | Control distribution |

### Key Takeaways

1. **Pro-rata is default** but not always best
2. **Equal is safest** when uncertain
3. **Historical needs data** (2+ years recommended)
4. **Weighted needs tiers** (A/B/C classification)
5. **Always validate** sum after allocation
6. **Handle edge cases** (zero sums, no history)
7. **Use window functions** for performance
8. **Provide fallbacks** for robustness

### Next Steps

1. Review your client's product catalog
2. Classify products by tier (if using weighted)
3. Verify historical data availability
4. Choose default strategy per KPI
5. Configure time-based overrides
6. Test with real data
7. Document rationale for business users

---

**Questions?** See `/home/user/DAG/FASTAPI_MIGRATION_PROMPT.md` for implementation details.
