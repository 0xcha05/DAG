# Production Architecture: Custom KPI System for 95 GB Datasets

## Overview

This KPI rebalancing engine supports **two execution modes**:

1. **POC Mode** (current): In-memory JavaScript execution for demonstration
2. **Production Mode** (new): ClickHouse SQL execution for 95 GB+ datasets

Both modes support:
- ✅ Formula-based KPIs (linear)
- ✅ Custom handler KPIs (non-linear)
- ✅ Arbitrary intermediate steps (validation, notifications, side effects)
- ✅ Full audit trail with execution logs

---

## Architecture Comparison

### POC Mode (Demo/Testing)

```
User Edits KPI
    ↓
Load ProductData into Memory (all weeks, all KPIs)
    ↓
Execute Custom Handler in JavaScript
    ├─ Access full historical data
    ├─ Run statistical calculations
    ├─ Execute intermediate steps
    └─ Return calculated value
    ↓
Update in-memory data
    ↓
Generate SQL explanation (for preview only)
```

**Limitations:**
- ❌ Crashes with 95 GB datasets (out of memory)
- ❌ Loads all product data (not scalable)
- ✅ Great for demos, testing, development

---

### Production Mode (95 GB Datasets)

```
User Edits KPI
    ↓
Generate Production SQL (no data loaded)
    ├─ Statistical calculations in SQL
    ├─ CTEs for multi-step logic
    ├─ Window functions for historical analysis
    └─ Subqueries for intermediate results
    ↓
Execute in ClickHouse (data stays in database)
    ↓
Update KPI values directly in ClickHouse
    ↓
Generate audit log entries
```

**Benefits:**
- ✅ Scales to 95 GB+ datasets
- ✅ No data movement (executes in database)
- ✅ Leverages ClickHouse performance
- ✅ Batch processing for all products

---

## Custom KPI Execution Flow

### 1. Formula-Based KPIs (Linear)

**Example:** `GM $ = Sls $ - COGS`

**POC Mode:**
```typescript
// Evaluated using mathjs
const result = evaluateFormula('Sls $ - COGS', currentValues);
```

**Production SQL:**
```sql
ALTER TABLE kpi_data
UPDATE gm_dollars = sls_dollars - cogs
WHERE product_id = 'PROD-001' AND week = 10
```

✅ **Both modes are identical** - simple formula generates simple SQL.

---

### 2. Custom Handler KPIs (Non-Linear)

**Example:** `Smart Reorder Point` (statistical calculation)

**POC Mode:**
```typescript
// JavaScript execution
'Smart Reorder Point': (productData, week, currentValues) => {
  // Load historical data from memory
  const salesHistory = [];
  for (let i = 0; i < 4; i++) {
    salesHistory.push(productData.weeks.get(week - i).values['Sls U']);
  }

  // Statistical calculations
  const avgDemand = mean(salesHistory);
  const stdDev = standardDeviation(salesHistory);
  const safetyStock = 1.645 * stdDev * sqrt(2);

  // Seasonal adjustment
  const seasonal = productData.weeks.get(week - 8).values['Sls U'];
  const seasonalFactor = clamp(seasonal / avgDemand, 0.8, 1.5);

  // Final calculation
  return round(avgDemand * 2 * seasonalFactor + safetyStock);
}
```

**Production SQL (Executable):**
```sql
ALTER TABLE kpi_data
UPDATE smart_reorder_point = (
  WITH
  historical AS (
    SELECT
      AVG(sls_u) as avg_demand,
      stddevPop(sls_u) as std_dev
    FROM kpi_data
    WHERE product_id = 'PROD-001'
      AND week >= 6 AND week < 10
  ),
  seasonal AS (
    SELECT sls_u as seasonal_sales
    FROM kpi_data
    WHERE product_id = 'PROD-001' AND week = 2
  )
  SELECT round(
    (h.avg_demand * 2) *
    greatest(0.8, least(1.5, s.seasonal_sales / h.avg_demand)) +
    (1.645 * h.std_dev * sqrt(2))
  )
  FROM historical h
  CROSS JOIN seasonal s
)
WHERE product_id = 'PROD-001' AND week = 10
```

**Key Difference:**
- **POC**: Loads data → JavaScript calculates → Shows SQL explanation
- **Production**: Generates SQL → ClickHouse calculates → Actual execution

---

## Arbitrary Intermediate Steps

### What Are Intermediate Steps?

Not all custom logic results in KPI updates. Sometimes you need to:
- ✅ Validate data before processing
- ✅ Send notifications/alerts
- ✅ Log events to external systems
- ✅ Trigger workflows
- ✅ Perform side effects (emails, API calls)

### Example: Inventory Alert System

**POC Mode:**
```typescript
// Custom handler with intermediate steps
'Smart Reorder Point': (productData, week, currentValues) => {
  const reorderPoint = calculateReorderPoint(productData, week);
  const currentInventory = currentValues['EOP U'];

  // INTERMEDIATE STEP 1: Validate data quality
  if (currentInventory < 0) {
    logError({
      type: 'data-quality',
      message: 'Negative inventory detected',
      product: productData.productId,
      week,
    });
    return 0; // Don't calculate if data is bad
  }

  // INTERMEDIATE STEP 2: Check if alert needed
  if (currentInventory < reorderPoint * 0.5) {
    // Critical low inventory
    sendAlert({
      severity: 'HIGH',
      message: `Inventory critically low: ${currentInventory} < ${reorderPoint * 0.5}`,
      product: productData.productId,
    });
  }

  // INTERMEDIATE STEP 3: Log to external analytics
  trackMetric('reorder_point_calculated', {
    product: productData.productId,
    week,
    value: reorderPoint,
    inventory: currentInventory,
    coverage: currentInventory / reorderPoint,
  });

  // FINAL STEP: Return the KPI value
  return reorderPoint;
}
```

**Production Mode:**
You have **two options** for intermediate steps:

#### Option A: Post-Processing (Recommended)

Run the ClickHouse UPDATE, then process intermediate steps in application:

```typescript
// 1. Execute ClickHouse SQL (update KPI)
await clickhouse.query(productionSQL);

// 2. Fetch results for post-processing
const results = await clickhouse.query(`
  SELECT
    product_id,
    week,
    smart_reorder_point,
    eop_u as current_inventory
  FROM kpi_data
  WHERE week = 10
`);

// 3. Run intermediate steps in application
results.forEach(row => {
  // Validation
  if (row.current_inventory < 0) {
    logError({ type: 'data-quality', product: row.product_id });
  }

  // Alerts
  if (row.current_inventory < row.smart_reorder_point * 0.5) {
    sendAlert({ severity: 'HIGH', product: row.product_id });
  }

  // Analytics
  trackMetric('reorder_point_calculated', {
    product: row.product_id,
    value: row.smart_reorder_point,
  });
});
```

#### Option B: ClickHouse Triggers/Webhooks

Use ClickHouse materialized views or external integrations:

```sql
-- Create materialized view for alerts
CREATE MATERIALIZED VIEW inventory_alerts
ENGINE = URL('https://your-api.com/alerts', JSONEachRow)
AS
SELECT
  product_id,
  week,
  smart_reorder_point,
  eop_u as current_inventory,
  'HIGH' as severity
FROM kpi_data
WHERE eop_u < smart_reorder_point * 0.5
```

---

## Complete Edit Flow Example

Let's trace what happens when user edits **Sls U** from 100 → 1200:

### POC Mode Flow

```
1. User edits "Sls U" = 1200 (Week 10)
   ↓
2. KPIEngine.rebalance() called
   ├─ Load ProductData into memory
   ├─ Apply edit: currentValues['Sls U'] = 1200
   └─ Log user edit
   ↓
3. Topological Sort
   ├─ Level 0: [Sls $, COGS, Return U] (formulas depend on Sls U)
   ├─ Level 1: [GM $, EOP U] (formulas depend on Level 0)
   └─ Level 2: [Smart Reorder Point] (custom handler depends on Sls U)
   ↓
4. Execute Level 0 (formulas)
   ├─ Sls $ = evaluateFormula('Sls U * AUR') = 1200 * 10 = 12000
   ├─ COGS = evaluateFormula('Sls U * AUC') = 1200 * 6 = 7200
   └─ Return U = evaluateFormula('Return % * Sls U') = 0.1 * 1200 = 120
   ↓
5. Execute Level 1 (formulas)
   ├─ GM $ = evaluateFormula('Sls $ - COGS') = 12000 - 7200 = 4800
   └─ EOP U = evaluateFormula('BOP U - Sls U + ...') = 500 - 1200 + 50 = -650
   ↓
6. Execute Level 2 (CUSTOM HANDLER)
   ├─ Check: hasCustomHandler('Smart Reorder Point') → TRUE
   ├─ Execute JavaScript handler:
   │   ├─ Gather inputs: Week 10, 9, 8, 7 Sls U values
   │   ├─ Step 1: Calculate avg_demand = (1200 + 95 + 90 + 85) / 4 = 367.5
   │   ├─ Step 2: Calculate std_dev = 522.8
   │   ├─ Step 3: lead_time_demand = 367.5 * 2 = 735
   │   ├─ Step 4: safety_stock = 1.645 * 522.8 * sqrt(2) = 1216.7
   │   ├─ Step 5: seasonal_factor (compare to week 2) = clamp(0.8, 1.5) = 0.8
   │   ├─ Step 6: reorder_point = 735 * 0.8 + 1216.7 = 1804.7
   │   ├─ Log all intermediate steps
   │   └─ Return: round(1804.7) = 1805
   ├─ Log: '[Custom Handler: Smart Reorder Point]'
   └─ Update: currentValues['Smart Reorder Point'] = 1805
   ↓
7. Generate ClickHouse Queries (for preview)
   ├─ Query 1: INSERT INTO kpi_audit_log (user edit)
   ├─ Query 2: UPDATE kpi_data SET sls_u = 1200
   ├─ Query 3-12: UPDATE kpi_data for formula KPIs
   ├─ Query 13: -- POC EXPLANATION for Smart Reorder Point
   │            -- Shows JavaScript execution with inputs/steps/output
   └─ Query 14: UPDATE kpi_data SET smart_reorder_point = 1805
   ↓
8. Display Queries Modal (not executed, just shown)
```

---

### Production Mode Flow

```
1. User edits "Sls U" = 1200 (Week 10)
   ↓
2. KPIEngine.rebalance() called
   ├─ NO data loaded (saves memory)
   ├─ Execute JavaScript ONLY to determine calculation order
   └─ Log user edit
   ↓
3. Topological Sort (same as POC)
   ├─ Level 0: [Sls $, COGS, Return U]
   ├─ Level 1: [GM $, EOP U]
   └─ Level 2: [Smart Reorder Point]
   ↓
4. Generate SQL for Level 0 (formulas)
   ├─ UPDATE kpi_data SET sls_dollars = sls_u * aur WHERE...
   ├─ UPDATE kpi_data SET cogs = sls_u * auc WHERE...
   └─ UPDATE kpi_data SET return_u = return_percent * sls_u WHERE...
   ↓
5. Generate SQL for Level 1 (formulas)
   ├─ UPDATE kpi_data SET gm_dollars = sls_dollars - cogs WHERE...
   └─ UPDATE kpi_data SET eop_u = bop_u - sls_u + ... WHERE...
   ↓
6. Generate PRODUCTION SQL for Level 2 (CUSTOM HANDLER)
   ├─ Check: hasProductionSQL('Smart Reorder Point') → TRUE
   ├─ Generate executable ClickHouse SQL:
   │   ```sql
   │   ALTER TABLE kpi_data
   │   UPDATE smart_reorder_point = (
   │     WITH historical AS (
   │       SELECT AVG(sls_u), stddevPop(sls_u) FROM kpi_data ...
   │     ),
   │     seasonal AS (
   │       SELECT sls_u FROM kpi_data WHERE week = 2
   │     )
   │     SELECT round(
   │       (avg_demand * 2) * seasonal_factor + safety_stock
   │     ) FROM historical, seasonal
   │   )
   │   WHERE product_id = 'PROD-001' AND week = 10
   │   ```
   ├─ Mark as [PRODUCTION] (executable, not explanation)
   └─ NO JavaScript execution needed
   ↓
7. Display Queries Modal
   ├─ All queries are EXECUTABLE
   ├─ Production SQL clearly marked: [PRODUCTION] Smart Reorder Point
   └─ Can be copy-pasted directly into ClickHouse
   ↓
8. (Optional) Execute in ClickHouse
   ├─ Run all UPDATE queries
   ├─ Process 95 GB dataset in database
   ├─ Fetch results for post-processing
   └─ Run intermediate steps (alerts, validation, analytics)
```

---

## When to Use Each Mode

### Use POC Mode When:
- ✅ Demonstrating to stakeholders
- ✅ Testing new KPI logic
- ✅ Prototyping formulas
- ✅ Dataset < 1 GB
- ✅ Development/debugging

### Use Production Mode When:
- ✅ Dataset > 10 GB (especially 95 GB)
- ✅ Production deployment
- ✅ Batch processing all products
- ✅ Real-time isn't critical
- ✅ Need database-level optimizations

---

## Implementing New Custom KPIs

### Step 1: Implement POC Handler (JavaScript)

```typescript
// src/engine/customKPIHandlers.ts
export const customKPIHandlers: Record<string, CustomKPIHandler> = {
  'Your New KPI': (productData, week, currentValues) => {
    // JavaScript logic with full data access
    const historicalData = getHistoricalData(productData, week);
    const result = yourComplexCalculation(historicalData);

    // Intermediate steps (optional)
    if (needsAlert(result)) {
      logAlert({ kpi: 'Your New KPI', value: result });
    }

    return result;
  }
};
```

### Step 2: Implement Production SQL

```typescript
// src/engine/customKPIProductionSQL.ts
function generateYourNewKPISQL(productId, week, year): ProductionSQL {
  return {
    kpiName: 'Your New KPI',
    description: 'What this KPI calculates',
    requiresMultiQuery: false,
    sql: `
      ALTER TABLE kpi_data
      UPDATE your_new_kpi = (
        WITH historical AS (
          -- SQL logic here
          SELECT ... FROM kpi_data ...
        )
        SELECT calculated_value FROM historical
      )
      WHERE product_id = {productId:String} AND week = {week:UInt8}
    `,
    explanation: [
      'Step 1: ...',
      'Step 2: ...',
    ],
    parameters: { productId, week, year }
  };
}
```

### Step 3: Register in Both Systems

```typescript
// Update getProductionSQL() to include your KPI
export function getProductionSQL(kpiName, productId, week, year) {
  switch (kpiName) {
    case 'Your New KPI':
      return generateYourNewKPISQL(productId, week, year);
    // ... other KPIs
  }
}
```

### Step 4: Add to Config

```typescript
// src/data/kpiConfig.ts
{
  name: 'Your New KPI',
  displayName: 'Your New KPI',
  isEditable: false,
  // No formula - uses custom handler
  dependsOn: ['Sls U', 'EOP U'],
  locksWhenEdited: [],
  description: 'Custom calculation for ...',
}
```

**Done!** Now your KPI works in both modes automatically.

---

## Key Takeaways

### ✅ What We Built

1. **Dual-Mode Architecture**
   - POC: JavaScript execution for demo
   - Production: SQL generation for 95 GB datasets

2. **Flexible KPI System**
   - Linear KPIs: Simple formulas
   - Non-Linear KPIs: Custom logic
   - Arbitrary Steps: Validation, alerts, side effects

3. **Full Transparency**
   - POC: Shows JavaScript execution logs
   - Production: Shows executable SQL with explanations
   - Both: Complete audit trail

### 🎯 Production Deployment Strategy

For your 95 GB dataset:

1. **Keep POC for Development**
   - Use in-memory mode for testing
   - Prototype new KPIs quickly
   - Debug with small data samples

2. **Use Production SQL for Scale**
   - Execute in ClickHouse
   - Batch process all products
   - Leverage database optimizations

3. **Hybrid Approach**
   - Simple KPIs: Pure SQL (formulas)
   - Complex but SQL-expressible: Production SQL (custom handlers)
   - Truly complex: Pre-compute in ETL or chunk processing

4. **Post-Processing for Intermediate Steps**
   - Run SQL updates first
   - Fetch results
   - Apply validation, alerts, analytics in application

### 🚀 Next Steps

- [ ] Test production SQL with ClickHouse
- [ ] Benchmark performance on 95 GB dataset
- [ ] Implement batch processing for all products
- [ ] Add monitoring for query execution times
- [ ] Create ETL jobs for pre-computation
- [ ] Set up post-processing pipeline for alerts/validation
