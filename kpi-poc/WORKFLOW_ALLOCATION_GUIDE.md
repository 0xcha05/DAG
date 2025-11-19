# KPI Rebalancing Engine: Technical Guide

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Execution Modes](#execution-modes)
3. [KPI Types](#kpi-types)
4. [Dependency Resolution](#dependency-resolution)
5. [Custom Handler Deep Dive](#custom-handler-deep-dive)
6. [SQL Generation](#sql-generation)
7. [Workflow Generation with Allocation](#workflow-generation-with-allocation)
8. [Implementation Guide](#implementation-guide)
9. [Dry Run Examples](#dry-run-examples)

---

## Workflow Generation with Allocation

### Overview

For production deployments, the KPI rebalancing engine generates workflow definitions that external frameworks can execute.

**Key Architecture Principle:** **Allocation strategy is defined per KPI in the config, NOT in the workflow context.**

Workflows support two types of edits:
1. **Single-Product Edits**: Direct update at granular level (product-week)
2. **Aggregated Edits**: Edit at aggregated level (dept-month), distribute to granular level (product-week)

### Core Concept: KPI-Specific Allocation

Each editable KPI defines its own allocation behavior in `kpiConfig.ts`:

```typescript
{
  name: 'Sls U',
  isEditable: true,
  allocationStrategy: {
    default: { strategy: 'pro_rata' },  // Use for most edits
    time: {
      year: {  // Override for year-level edits
        strategy: 'historical',
        historical: { lookbackYears: 2, sameTimePeriod: true }
      }
    }
  },
  allocationValidation: {
    validateSum: true,
    tolerance: 0.01,
    onValidationFailure: 'error'
  }
}
```

**When user edits "Electronics, 2024, Sls U = 500,000":**
1. System looks up Sls U's allocation config
2. Checks edit level: `year`
3. Finds `time.year` strategy: `historical`
4. Uses 2-year lookback to distribute seasonally

**When user edits "Electronics, Jan 2024, Sls U = 50,000":**
1. System looks up Sls U's allocation config
2. Checks edit level: `month`
3. No `time.month` defined → falls back to `default`
4. Uses `pro_rata` to distribute proportionally

### Allocation Strategy Types

| Strategy | Description | Use Case |
|----------|-------------|----------|
| **pro_rata** | Proportional to current values | Maintain current mix |
| **equal** | Distribute evenly | Percentages, inventory |
| **historical** | Based on past patterns | Seasonal data (year-level) |
| **weighted** | Priority-based (A/B/C tiers) | Strategic allocation |
| **custom** | User-provided SQL | Complex business rules |

### Workflow Structure

```typescript
interface WorkflowDefinition {
  workflow_id: string;
  description: string;
  steps: WorkflowStep[];
  memory_limits: { max_memory_mb: number; cleanup_threshold_mb: number };
  max_parallel_steps: number;
  timeout_seconds: number;
}

interface WorkflowStep {
  step_id: string;
  description: string;
  source_table: string;
  target_table: string;
  process_sql: string;
  cleanup_source: boolean;
  dependencies: string[];
}
```

### Aggregation Context

Describes **where** the edit is made, not **how** to allocate (that comes from KPI config):

```typescript
interface AggregationContext {
  // Time dimension (optional)
  time?: {
    level: 'year' | 'quarter' | 'month' | 'week';
    sqlExpression: string;  // How to map storage → edit level
  };

  // Hierarchy dimension (optional)
  hierarchy?: {
    level: string;      // 'dept', 'subdept', 'category', etc.
    levels: string[];   // All hierarchy columns at this level
  };

  // Filter for records to distribute to
  where: string;

  // Storage granularity (target for distribution)
  granularity: string[];  // ['product_id', 'week', 'year']
}
```

### Strategy Selection Logic

The workflow generator uses this logic to pick the right strategy:

```typescript
function getAllocationStrategy(kpiName: KPIName, aggContext: AggregationContext) {
  const kpiConfig = kpiConfigs.find(c => c.name === kpiName);

  // 1. Check time-specific strategy
  if (aggContext.time && kpiConfig.allocationStrategy.time) {
    const timeLevel = aggContext.time.level;  // 'year', 'month', etc.
    if (kpiConfig.allocationStrategy.time[timeLevel]) {
      return kpiConfig.allocationStrategy.time[timeLevel];  // ✓ Found
    }
  }

  // 2. Check hierarchy-specific strategy
  if (aggContext.hierarchy && kpiConfig.allocationStrategy.hierarchy) {
    const hierarchyLevel = aggContext.hierarchy.level;  // 'dept', 'subdept', etc.
    if (kpiConfig.allocationStrategy.hierarchy[hierarchyLevel]) {
      return kpiConfig.allocationStrategy.hierarchy[hierarchyLevel];  // ✓ Found
    }
  }

  // 3. Fall back to default
  return kpiConfig.allocationStrategy.default;
}
```

### Example 1: Single-Product Edit (No Allocation)

**Scenario:** User edits "Product P001, Week 14, 2024, Sls U = 150"

**Code:**
```typescript
const workflow = generateSingleProductEditWorkflow({
  editedKPI: 'Sls U',
  editedValue: 150,
  productId: 'P001',
  week: 14,
  year: 2024
});
```

**Generated Workflow:**
```json
{
  "workflow_id": "edit_Sls_U_1637152923",
  "steps": [
    {
      "step_id": "edit_Sls_U_1637152923_apply_edit",
      "description": "Update Sls U for product P001",
      "process_sql": "ALTER TABLE kpi_data UPDATE sls_u = 150 WHERE product_id = 'P001' AND year = 2024 AND week = 14",
      "dependencies": []
    },
    {
      "step_id": "edit_Sls_U_1637152923_rebalance_GM_$_L0",
      "description": "Rebalance GM $ using formula: Sls $ - COGS",
      "process_sql": "ALTER TABLE kpi_data UPDATE gm_d = divide(sls_d, cogs) WHERE product_id = 'P001' AND year = 2024 AND week = 14",
      "dependencies": ["edit_Sls_U_1637152923_apply_edit"]
    }
  ]
}
```

### Example 2: Year-Level Edit (Historical Strategy)

**Scenario:** User edits "Electronics, 2024, Sls U = 500,000"

**KPI Config for Sls U:**
```typescript
allocationStrategy: {
  default: { strategy: 'pro_rata' },
  time: {
    year: {
      strategy: 'historical',
      historical: { lookbackYears: 2, sameTimePeriod: true }
    }
  }
}
```

**Code:**
```typescript
const workflow = generateAggregatedEditWorkflow({
  editedKPI: 'Sls U',
  editedValue: 500000,
  aggregationContext: {
    time: {
      level: 'year',  // ← Triggers historical strategy
      sqlExpression: 'year'
    },
    hierarchy: {
      level: 'dept',
      levels: ['dept']
    },
    where: "dept = 'Electronics' AND year = 2024",
    granularity: ['product_id', 'week', 'year']
  }
});
```

**Strategy Selection:**
1. Check `time.year` in Sls U config → **Found: historical**
2. Use 2-year lookback for seasonal distribution

**Generated Workflow Steps:**
```json
{
  "steps": [
    {
      "step_id": "..._calculate_current",
      "description": "Calculate current aggregate value",
      "process_sql": "SELECT year, dept, SUM(sls_u) FROM kpi_data WHERE dept = 'Electronics' AND year = 2024 GROUP BY year, dept"
    },
    {
      "step_id": "..._calculate_weights",
      "description": "Calculate allocation weights using historical strategy",
      "process_sql": "WITH historical_values AS (SELECT product_id, week, AVG(sls_u) FROM kpi_data WHERE dept = 'Electronics' AND year IN (2022, 2023) GROUP BY product_id, week) SELECT product_id, week, avg_sls / SUM(avg_sls) as weight FROM historical_values"
    },
    {
      "step_id": "..._calculate_deltas",
      "description": "Calculate delta to distribute",
      "process_sql": "SELECT product_id, week, year, (500000 - current_value) * weight as delta FROM weights CROSS JOIN current_aggregate"
    },
    {
      "step_id": "..._apply_edits",
      "description": "Apply distributed edits",
      "process_sql": "ALTER TABLE kpi_data UPDATE sls_u = sls_u + delta WHERE ..."
    },
    {
      "step_id": "..._validate",
      "description": "Validate distributed sum equals edited value",
      "process_sql": "SELECT SUM(sls_u), ABS(SUM(sls_u) - 500000) as diff FROM kpi_data WHERE dept = 'Electronics' AND year = 2024"
    }
  ]
}
```

### Example 3: Month-Level Edit (Pro-Rata Strategy)

**Scenario:** User edits "Electronics, Jan 2024, Sls U = 50,000"

**KPI Config for Sls U:**
```typescript
allocationStrategy: {
  default: { strategy: 'pro_rata' },  // ← Will use this
  time: {
    year: { strategy: 'historical' }  // Not month!
  }
}
```

**Code:**
```typescript
const workflow = generateAggregatedEditWorkflow({
  editedKPI: 'Sls U',
  editedValue: 50000,
  aggregationContext: {
    time: {
      level: 'month',  // ← No time.month strategy → uses default
      sqlExpression: 'toMonth(toDate(year, 1, 1) + toIntervalWeek(week))'
    },
    hierarchy: {
      level: 'dept',
      levels: ['dept']
    },
    where: "dept = 'Electronics' AND toMonth(toDate(year, 1, 1) + toIntervalWeek(week)) = 1 AND year = 2024",
    granularity: ['product_id', 'week', 'year']
  }
});
```

**Strategy Selection:**
1. Check `time.month` in Sls U config → **Not found**
2. Fall back to `default` → **pro_rata**

**Generated SQL (Pro-Rata Weights):**
```sql
-- Calculate weights proportional to current values
WITH granular_values AS (
  SELECT
    toMonth(toDate(year, 1, 1) + toIntervalWeek(week)) as time_group,
    dept,
    product_id, week, year,
    sls_u as current_value
  FROM kpi_data
  WHERE dept = 'Electronics'
    AND toMonth(toDate(year, 1, 1) + toIntervalWeek(week)) = 1
    AND year = 2024
),
totals AS (
  SELECT time_group, dept, SUM(current_value) as total_value
  FROM granular_values
  GROUP BY time_group, dept
)
SELECT
  g.product_id, g.week, g.year,
  g.current_value / t.total_value as weight
FROM granular_values g
JOIN totals t ON g.time_group = t.time_group AND g.dept = t.dept

-- Result:
-- product_id | week | year | weight
-- P001       | 1    | 2024 | 0.00208  (100 / 48000)
-- P001       | 2    | 2024 | 0.00312  (150 / 48000)
-- ...
```

### Example 4: Hierarchy-Specific Strategy

**Scenario:** User edits "Electronics, Week 1, BOP U = 100,000"

**KPI Config for BOP U:**
```typescript
allocationStrategy: {
  default: { strategy: 'equal' },
  hierarchy: {
    dept: { strategy: 'pro_rata' }  // ← Override for dept-level
  }
}
```

**Code:**
```typescript
const workflow = generateAggregatedEditWorkflow({
  editedKPI: 'BOP U',
  editedValue: 100000,
  aggregationContext: {
    hierarchy: {
      level: 'dept',  // ← Triggers pro_rata (not equal)
      levels: ['dept']
    },
    where: "dept = 'Electronics' AND week = 1 AND year = 2024",
    granularity: ['product_id', 'week', 'year']
  }
});
```

**Strategy Selection:**
1. Check `hierarchy.dept` in BOP U config → **Found: pro_rata**
2. Distribute proportionally (not equally)

### KPI Allocation Strategies Reference

| KPI | Default | Time Overrides | Hierarchy Overrides |
|-----|---------|----------------|---------------------|
| Sls U | pro_rata | year: historical | - |
| Sls $ | pro_rata | year: historical | - |
| DR% | equal | - | - |
| Return % | equal | - | - |
| BOP U | equal | - | dept: pro_rata |
| BOP $ | equal | - | dept: pro_rata |
| Total Rcpt U | pro_rata | - | - |
| Total Rcpt $ | pro_rata | - | - |
| AUC | historical | - | - |

### Validation

Each KPI can have validation configuration:

```typescript
allocationValidation: {
  validateSum: true,
  tolerance: 0.01,
  onValidationFailure: 'error'  // or 'warn' or 'ignore'
}
```

**Generated Validation SQL:**
```sql
-- Validate distribution sum
WITH validation AS (
  SELECT
    SUM(sls_u) as actual_sum,
    50000 as expected_sum,
    ABS(SUM(sls_u) - 50000) as difference
  FROM kpi_data
  WHERE dept = 'Electronics' AND month = 1 AND year = 2024
)
SELECT
  *,
  CASE
    WHEN difference > 0.01 THEN 'THROW: Sum mismatch by ' || toString(difference)
    ELSE 'OK'
  END as validation_result
FROM validation
```

### Complete Flow: Aggregated Edit

**User Action:** "Electronics, January 2024, Sls U = 50,000"

**Step-by-Step:**

1. **Construct AggregationContext**
   ```typescript
   {
     time: { level: 'month', sqlExpression: '...' },
     hierarchy: { level: 'dept', levels: ['dept'] },
     where: "dept = 'Electronics' AND month = 1 AND year = 2024",
     granularity: ['product_id', 'week', 'year']
   }
   ```

2. **Lookup Strategy**
   - Check Sls U config
   - time.level = 'month' → No `time.month` strategy
   - Use `default`: pro_rata

3. **Generate Workflow**
   - Step 1: Calculate current aggregate (48,000)
   - Step 2: Calculate pro-rata weights
   - Step 3: Calculate deltas (50,000 - 48,000) * weight
   - Step 4: Apply edits
   - Step 5: Validate (if enabled)
   - Step 6+: Rebalance dependent KPIs

4. **Execute SQL**
   - Products updated proportionally
   - Dependent KPIs recalculate from formulas
   - Validation confirms sum = 50,000

### Dependent KPI Handling

**Critical:** Only the **edited KPI** gets distributed. Dependent KPIs **always recalculate from formulas**.

```
User edits: Sls U = 50,000 (dept-level)

1. Distribute Sls U → product-week level using allocation strategy
   P001, W1: 100 → 104.16
   P001, W2: 150 → 156.24
   ...

2. Recalculate dependent KPIs from formulas (NO distribution)
   GM $ = Sls $ - COGS  ← Formula applied to each product-week
   GM% = GM $ / Sls $   ← Formula applied to each product-week
   WOS = EOP U / Sls U  ← Formula applied to each product-week

✓ Each product-week gets its own GM $, GM%, WOS based on its new Sls U
✗ We do NOT distribute GM $ separately!
```

### Usage Examples

**Simple Case: Single Product**
```typescript
import { generateSingleProductEditWorkflow } from './workflows/workflowGenerator';

const workflow = generateSingleProductEditWorkflow({
  editedKPI: 'Sls U',
  editedValue: 150,
  productId: 'P001',
  week: 14,
  year: 2024
});
```

**Aggregated Case: Year Level**
```typescript
import { generateAggregatedEditWorkflow } from './workflows/workflowGenerator';

const workflow = generateAggregatedEditWorkflow({
  editedKPI: 'Sls U',
  editedValue: 500000,
  aggregationContext: {
    time: { level: 'year', sqlExpression: 'year' },
    hierarchy: { level: 'dept', levels: ['dept'] },
    where: "dept = 'Electronics' AND year = 2024",
    granularity: ['product_id', 'week', 'year']
  }
});
// Uses historical strategy (from Sls U config, time.year)
```

**Aggregated Case: Month Level**
```typescript
const workflow = generateAggregatedEditWorkflow({
  editedKPI: 'Sls U',
  editedValue: 50000,
  aggregationContext: {
    time: {
      level: 'month',
      sqlExpression: 'toMonth(toDate(year, 1, 1) + toIntervalWeek(week))'
    },
    hierarchy: { level: 'dept', levels: ['dept'] },
    where: "dept = 'Electronics' AND toMonth(...) = 1 AND year = 2024",
    granularity: ['product_id', 'week', 'year']
  }
});
// Uses pro_rata strategy (from Sls U config, default)
```

### Client Flexibility

The system adapts to **any** client database structure:

| Client Structure | How We Handle |
|------------------|---------------|
| No hierarchy | Time-only aggregation |
| 1 hierarchy level | `levels: ['dept']` |
| Multi-level hierarchy | `levels: ['dept', 'subdept', 'category']` |
| Multi-dimensional | `levels: ['dept', 'channel', 'region']` |
| Custom time columns | `sqlExpression: 'fiscal_quarter'` |
| Any granularity | `granularity: ['sku', 'week_start_date', 'fiscal_year']` |

### See Also

- `/workflows/examples.ts` - 7 complete workflow examples
- `/workflows/workflowGenerator.ts` - Full implementation
- `/workflows/types.ts` - Type definitions

---
