# Custom KPI Handler Guide

## Overview

The KPI Rebalancing Engine supports **two types of KPI calculations**:

1. **Formula-Based KPIs** - Simple mathematical expressions (e.g., `GM $ = Sls $ - COGS`)
2. **Custom Handler KPIs** - Complex, non-linear calculations requiring custom business logic

This guide explains how to implement and use **Custom Handler KPIs** for scenarios where simple formulas cannot express the calculation logic.

---

## When to Use Custom Handlers

Use custom handlers when your KPI calculation requires:

- **Historical analysis** (variance, moving averages, statistical analysis)
- **Forecasting** (looking ahead multiple weeks)
- **Conditional logic** (if-then rules, multi-branch decisions)
- **Multi-step algorithms** (optimization, recommendations)
- **External data lookups** (seasonal factors, market data)
- **Statistical calculations** (standard deviation, percentiles, regression)

### Examples of Custom KPIs

| KPI Name | Why It Needs Custom Handler |
|----------|------------------------------|
| **Smart Reorder Point** | Statistical analysis, variance calculation, lead time consideration, safety stock |
| **Recommended Receipts** | Forecasting based on 3-week average, target weeks of supply |
| **Dynamic MD Price** | Performance-based pricing algorithm with inventory position analysis |
| **Promo Lift %** | Comparative analysis against non-promo baseline weeks |
| **Stock Health Score** | Multi-factor scoring: turnover, aging, sell-through rate |
| **Demand Forecast** | Time series analysis, seasonality, trend detection |

---

## How Custom Handlers Work

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ KPIEngine.rebalance()                                       │
│                                                             │
│  1. User edits a KPI                                        │
│  2. Calculate dependent KPIs in topological order           │
│  3. For each KPI:                                           │
│     ┌──────────────────────────────────────────────┐       │
│     │ hasCustomHandler(kpi) ?                      │       │
│     │                                              │       │
│     │ YES ──> executeCustomHandler()              │       │
│     │         - Access full ProductData            │       │
│     │         - Multi-week lookback/lookahead      │       │
│     │         - Complex calculations               │       │
│     │                                              │       │
│     │ NO  ──> evaluateFormula()                   │       │
│     │         - Simple math expression             │       │
│     │         - Current week values only           │       │
│     └──────────────────────────────────────────────┘       │
│                                                             │
│  4. Log and return results                                  │
└─────────────────────────────────────────────────────────────┘
```

### Custom Handler Registry

Custom handlers are registered in `src/engine/customKPIHandlers.ts`:

```typescript
export const customKPIHandlers: Record<string, CustomKPIHandler> = {
  'Smart Reorder Point': (productData, week, currentValues) => {
    // Complex calculation logic here
    return calculatedValue;
  },
  'Recommended Receipts': (productData, week, currentValues) => {
    // Forecasting logic here
    return calculatedValue;
  },
  // ... more custom handlers
};
```

### Handler Function Signature

```typescript
type CustomKPIHandler = (
  productData: ProductData,   // Full access to all weeks
  week: number,                // Current week being calculated
  currentValues?: Record<string, number>  // Current week's KPI values
) => number;  // Returns the calculated KPI value
```

---

## Example 1: Smart Reorder Point

### Business Logic

Calculate optimal reorder point considering:
- **Average demand** over last 4 weeks
- **Demand variability** (standard deviation)
- **Lead time** (2 weeks to receive inventory)
- **Service level** (95% - willing to risk 5% stockout)
- **Seasonal adjustments** (compare to 8 weeks ago)

### Implementation

```typescript
'Smart Reorder Point': (productData, week) => {
  const LEAD_TIME_WEEKS = 2;
  const SERVICE_LEVEL_Z = 1.645; // 95% confidence (Z-score)
  const LOOKBACK_WEEKS = 4;

  // Step 1: Gather sales history (last 4 weeks)
  const salesHistory: number[] = [];
  for (let i = 0; i < LOOKBACK_WEEKS; i++) {
    const historicalWeek = productData.weeks.get(week - i);
    if (historicalWeek) {
      salesHistory.push(historicalWeek.values['Sls U']);
    }
  }

  // Step 2: Calculate average demand
  const avgDemand = salesHistory.reduce((sum, s) => sum + s, 0) / salesHistory.length;

  // Step 3: Calculate standard deviation
  const variance = salesHistory.reduce(
    (sum, s) => sum + Math.pow(s - avgDemand, 2), 0
  ) / salesHistory.length;
  const stdDev = Math.sqrt(variance);

  // Step 4: Calculate demand during lead time
  const leadTimeDemand = avgDemand * LEAD_TIME_WEEKS;

  // Step 5: Calculate safety stock (buffer for variability)
  const safetyStock = SERVICE_LEVEL_Z * stdDev * Math.sqrt(LEAD_TIME_WEEKS);

  // Step 6: Seasonal adjustment (compare to 8 weeks ago)
  let seasonalFactor = 1.0;
  const sameWeekLastCycle = productData.weeks.get(week - 8);
  if (sameWeekLastCycle && avgDemand > 0) {
    const lastCycleSales = sameWeekLastCycle.values['Sls U'];
    seasonalFactor = lastCycleSales / avgDemand;
    seasonalFactor = Math.max(0.8, Math.min(1.5, seasonalFactor)); // Cap at ±50%
  }

  // Step 7: Final reorder point
  const reorderPoint = leadTimeDemand * seasonalFactor + safetyStock;
  return Math.round(reorderPoint);
}
```

### Why This Can't Be a Formula

❌ **Cannot use formula:**
- Requires 4-week lookback (formulas only access current week)
- Needs variance calculation (not expressible in simple math)
- Statistical functions (Z-score, square root of sums)
- Conditional logic for seasonal adjustment

✅ **Custom handler provides:**
- Access to `productData.weeks` (all historical data)
- Loop constructs for aggregation
- Complex math operations
- Conditional branching

---

## Example 2: Recommended Receipts

### Business Logic

Forecast how many units should be received in the next 3 weeks based on:
- **3-week average sales** (smoothing out volatility)
- **Target weeks of supply** (maintain 3 weeks of inventory)
- **Current inventory position** (adjust for overstocking)

### Implementation

```typescript
'Recommended Receipts': (productData, week) => {
  const LOOKBACK_WEEKS = 3;
  const LOOKAHEAD_WEEKS = 3;
  const TARGET_WOS = 3; // Weeks of Supply

  // Step 1: Calculate 3-week average sales
  let totalSales = 0;
  let weekCount = 0;
  for (let i = 1; i <= LOOKBACK_WEEKS; i++) {
    const pastWeek = productData.weeks.get(week - i);
    if (pastWeek) {
      totalSales += pastWeek.values['Sls U'] || 0;
      weekCount++;
    }
  }
  const avgWeeklySales = weekCount > 0 ? totalSales / weekCount : 0;

  // Step 2: Calculate forecasted need
  const forecastedNeed = avgWeeklySales * LOOKAHEAD_WEEKS;

  // Step 3: Get current inventory position
  const currentWeek = productData.weeks.get(week);
  const currentInventory = currentWeek ? (currentWeek.values['EOP U'] || 0) : 0;

  // Step 4: Calculate receipts needed
  const targetInventory = avgWeeklySales * TARGET_WOS;
  const receiptsNeeded = Math.max(0, targetInventory - currentInventory + forecastedNeed);

  return Math.round(receiptsNeeded);
}
```

### SQL Generation (ClickHouse Mode)

When in ClickHouse mode, the system generates an explanation:

```sql
-- CUSTOM HANDLER EXPLANATION: Recommended Receipts
-- This KPI cannot be calculated with a simple formula
-- Forecasts receipt needs based on sales trends and inventory targets
--
-- Implementation requires COMPLEX LOGIC:
-- Step 1: Calculate 3-week average sales (lookback)
-- Step 2: Forecast demand for next 3 weeks
-- Step 3: Get current inventory position (EOP U)
-- Step 4: Calculate receipts to maintain 3 weeks of supply
-- Step 5: Adjust for current overstocking/understocking
--
-- The final UPDATE query (below) sets the calculated value,
-- but the actual calculation logic is implemented in application code.

ALTER TABLE kpi_data
UPDATE
  rec_rcpt_u = {newValue:Float64},
  last_edited_kpi = {kpiName:String},
  last_edited_timestamp = now(),
  updated_at = now()
WHERE product_id = {productId:String}
  AND week = {week:UInt8}

-- Parameters:
-- productId = 'PROD-001'
-- week = 10
-- kpiName = 'Recommended Receipts'
-- newValue = 342
```

---

## Execution Modes

### In-Memory Mode

**What happens:**
1. User edits a KPI (e.g., "Sls U" from 1000 → 1200)
2. Engine calculates dependent KPIs in topological order
3. When it encounters "Smart Reorder Point":
   - Checks: `hasCustomHandler('Smart Reorder Point')` → `true`
   - Executes: `executeCustomHandler('Smart Reorder Point', productData, week, values)`
   - Custom function runs, accesses historical data, performs statistical calculations
   - Returns calculated value (e.g., `285`)
4. Value is updated immediately in memory
5. Grid shows yellow highlight for changed value
6. Log entry created: `[Custom Handler: Smart Reorder Point]`

**Benefits:**
- Real-time calculation
- Full access to historical data
- Complex logic executes instantly
- Interactive "what-if" analysis

### ClickHouse Mode

**What happens:**
1. User edits a KPI (e.g., "Sls U" from 1000 → 1200)
2. Engine calculates what **would** change (but doesn't apply it)
3. For each custom handler KPI:
   - Generates **explanation query** (shows multi-step logic)
   - Generates **audit log INSERT** (with `[Custom Handler: ...]` formula)
   - Generates **value UPDATE** (sets the calculated value)
4. Modal displays all queries
5. **Data remains unchanged** (preview only)

**Benefits:**
- Understand SQL structure before execution
- See what custom logic is doing
- Plan database integration
- Audit trail for complex calculations

---

## Complete Example: User Edits Sls U

### Scenario

- Product: PROD-001
- Week: 10
- Edit: "Sls U" changes from 1000 → 1200
- Custom KPI: "Smart Reorder Point" depends on Sls U history

### In-Memory Mode Output

```
✓ Sls U updated: 1000 → 1200
✓ Sls $ recalculated: 10000 → 12000 (formula: Sls U * AUR)
✓ COGS recalculated: 6000 → 7200 (formula: Sls U * AUC)
✓ GM $ recalculated: 4000 → 4800 (formula: Sls $ - COGS)
✓ Smart Reorder Point recalculated: 280 → 285 [CUSTOM HANDLER]
  - Historical avg demand: 1150 units
  - Std deviation: 95 units
  - Lead time demand: 2300 units
  - Safety stock: 220 units
  - Seasonal factor: 1.05
  - Reorder point: 285 units

Logs:
[user-edit] Sls U: 1000 → 1200 (Week 10)
[system-recalc] Sls $: 10000 → 12000 (Level 1, formula: Sls U * AUR)
[system-recalc] COGS: 6000 → 7200 (Level 1, formula: Sls U * AUC)
[system-recalc] GM $: 4000 → 4800 (Level 2, formula: Sls $ - COGS)
[system-recalc] Smart Reorder Point: 280 → 285 (Level 3, [Custom Handler: Smart Reorder Point])
```

### ClickHouse Mode Output

**Generated Queries (9 total):**

```sql
-- Query 1: Log user edit
INSERT INTO kpi_audit_log (...)
VALUES ('user-edit', 'PROD-001', 10, 2024, 'Sls U', 1000, 1200, ...)

-- Query 2: Update Sls U
ALTER TABLE kpi_data UPDATE sls_u = 1200 WHERE product_id = 'PROD-001' AND week = 10

-- Query 3: Log Sls $ recalc
INSERT INTO kpi_audit_log (...)
VALUES ('system-recalc', 'PROD-001', 10, 2024, 'Sls $', 10000, 12000, 'Sls U', 1, 'Sls U * AUR', ...)

-- Query 4: Update Sls $
ALTER TABLE kpi_data UPDATE sls_dollars = 12000 WHERE product_id = 'PROD-001' AND week = 10

-- Query 5: Log Smart Reorder Point recalc [CUSTOM HANDLER]
INSERT INTO kpi_audit_log (...)
VALUES ('system-recalc', 'PROD-001', 10, 2024, 'Smart Reorder Point', 280, 285, 'Sls U', 3, '[Custom Handler: Smart Reorder Point]', ...)

-- Query 6: CUSTOM HANDLER EXPLANATION
-- CUSTOM HANDLER EXPLANATION: Smart Reorder Point
-- This KPI cannot be calculated with a simple formula
-- Statistical reorder point calculation with lead time, service level, and seasonality
--
-- Implementation requires COMPLEX LOGIC:
-- Step 1: Gather 4-week sales history
-- Step 2: Calculate average demand
-- Step 3: Calculate standard deviation (variance analysis)
-- Step 4: Calculate lead time demand (avg * 2 weeks)
-- Step 5: Calculate safety stock (Z-score * stdDev * sqrt(leadTime))
-- Step 6: Apply seasonal adjustment (compare to 8 weeks ago)
-- Step 7: Final reorder point = leadTimeDemand * seasonal + safetyStock
--
-- The final UPDATE query (below) sets the calculated value,
-- but the actual calculation logic is implemented in application code.

-- Query 7: Update Smart Reorder Point
ALTER TABLE kpi_data UPDATE smart_reorder_point = 285 WHERE product_id = 'PROD-001' AND week = 10

-- ... (more queries for other KPIs)
```

---

## Adding New Custom KPIs

### Step 1: Implement the Handler

Edit `src/engine/customKPIHandlers.ts`:

```typescript
export const customKPIHandlers: Record<string, CustomKPIHandler> = {
  // ... existing handlers

  'Your New KPI': (productData, week, currentValues) => {
    // Your complex calculation logic here

    // Example: Access historical data
    const lastWeek = productData.weeks.get(week - 1);
    const historicalValue = lastWeek?.values['Some KPI'] || 0;

    // Example: Use current week values
    const currentSales = currentValues?.['Sls U'] || 0;

    // Example: Complex calculation
    const result = Math.sqrt(historicalValue * currentSales) + 42;

    return result;
  },
};
```

### Step 2: Add SQL Explanation

In the same file, add to `getCustomHandlerSQL`:

```typescript
export function getCustomHandlerSQL(
  kpiName: KPIName,
  productId: string,
  week: number
): { description: string; requiresMultiQuery: boolean; steps: string[] } {
  switch (kpiName) {
    // ... existing cases

    case 'Your New KPI':
      return {
        description: 'Brief explanation of what this KPI calculates',
        requiresMultiQuery: false, // true if needs temp tables or multiple queries
        steps: [
          'Step 1: Access historical data from previous week',
          'Step 2: Get current sales units',
          'Step 3: Apply complex formula with square root',
          'Step 4: Add business constant (42)',
        ],
      };

    default:
      return {
        description: 'Custom calculation',
        requiresMultiQuery: false,
        steps: ['Custom logic implemented in application code'],
      };
  }
}
```

### Step 3: Add to KPI Configuration

Add the KPI to your config (if not already present):

```typescript
{
  name: 'Your New KPI',
  displayName: 'Your New KPI',
  editable: false,
  formula: undefined,  // No formula - uses custom handler
  dependsOn: ['Sls U'],  // Dependencies for topological sort
  locksWhenEdited: [],
}
```

### Step 4: Update Type Definitions (if needed)

If your KPI name isn't in the `KPIName` type, add it:

```typescript
export type KPIName =
  | 'Sls U'
  | 'Sls $'
  // ... existing KPIs
  | 'Your New KPI';
```

---

## Testing Custom Handlers

### Manual Testing (In-Memory Mode)

1. Switch to "In-Memory" mode in the UI
2. Edit a KPI that triggers your custom handler
3. Check the logs panel for `[Custom Handler: Your New KPI]`
4. Verify the calculated value is correct
5. Check highlighted cells in the grid

### Preview SQL (ClickHouse Mode)

1. Switch to "ClickHouse" mode in the UI
2. Edit a KPI that triggers your custom handler
3. Modal appears with generated queries
4. Look for "CUSTOM HANDLER EXPLANATION" query
5. Verify steps match your implementation
6. Check that final UPDATE query has correct value

### Unit Testing

```typescript
import { executeCustomHandler } from './customKPIHandlers';

describe('Custom KPI: Smart Reorder Point', () => {
  it('should calculate reorder point with safety stock', () => {
    const mockProductData = {
      productId: 'PROD-001',
      weeks: new Map([
        [6, { values: { 'Sls U': 1000 } }],
        [7, { values: { 'Sls U': 1100 } }],
        [8, { values: { 'Sls U': 1050 } }],
        [9, { values: { 'Sls U': 1200 } }],
        [10, { values: { 'Sls U': 1150 } }],
      ]),
    };

    const result = executeCustomHandler(
      'Smart Reorder Point',
      mockProductData,
      10
    );

    expect(result).toBeGreaterThan(0);
    expect(result).toBeCloseTo(285, 0);
  });
});
```

---

## Best Practices

### 1. Document Your Logic

Add comprehensive comments explaining:
- What the KPI represents
- Why it needs custom logic
- Each step of the calculation
- Any business constants or thresholds

### 2. Handle Missing Data

```typescript
'Your KPI': (productData, week) => {
  const lastWeek = productData.weeks.get(week - 1);

  // ❌ BAD: Assumes data exists
  const value = lastWeek.values['Sls U'];

  // ✅ GOOD: Handles missing data
  const value = lastWeek?.values['Sls U'] || 0;

  return value * 2;
}
```

### 3. Add Validation

```typescript
'Your KPI': (productData, week) => {
  const sales = currentValues?.['Sls U'] || 0;

  // Validate input
  if (sales < 0) {
    console.warn('Negative sales detected, using 0');
    return 0;
  }

  const result = sales * 1.5;

  // Validate output
  if (result > 10000) {
    console.warn('Result exceeds maximum, capping at 10000');
    return 10000;
  }

  return result;
}
```

### 4. Optimize for Performance

```typescript
// ❌ BAD: Recalculates same value multiple times
'Your KPI': (productData, week) => {
  for (let i = 0; i < 10; i++) {
    const avg = calculateAverage(productData, week); // Called 10 times
    // ... use avg
  }
}

// ✅ GOOD: Calculate once, reuse
'Your KPI': (productData, week) => {
  const avg = calculateAverage(productData, week); // Called once
  for (let i = 0; i < 10; i++) {
    // ... use avg
  }
}
```

### 5. Keep It Pure

Custom handlers should be **pure functions**:
- No side effects (don't modify productData)
- Deterministic (same inputs = same output)
- No external API calls or async operations

```typescript
// ❌ BAD: Modifies input
'Your KPI': (productData, week) => {
  productData.weeks.get(week).values['Sls U'] = 999; // Mutates data
  return 100;
}

// ✅ GOOD: Pure function
'Your KPI': (productData, week) => {
  const sales = productData.weeks.get(week)?.values['Sls U'] || 0;
  return sales * 1.5;
}
```

---

## Limitations

### Current Limitations

1. **No async operations**: Custom handlers must be synchronous
2. **No external data**: Cannot call APIs or fetch external data
3. **Memory-bound**: All historical data must fit in memory
4. **No database queries**: In-memory only (ClickHouse mode generates SQL but doesn't execute)

### ClickHouse Mode Limitations

When in ClickHouse mode:
- Custom handlers **still execute** to calculate values
- SQL explanation is **descriptive only** (shows steps, not actual SQL)
- Cannot generate equivalent SQL for complex statistical operations
- Actual calculation must happen in application layer

**Workaround for ClickHouse:**
- Implement custom handlers as **stored procedures** or **materialized views**
- Use **application-side calculation** with batch updates
- Consider **pre-computing** complex KPIs during ETL

---

## Summary

**Custom KPI Handlers enable:**
- ✅ Complex, non-linear calculations
- ✅ Historical data analysis (lookback)
- ✅ Forecasting (lookahead)
- ✅ Statistical operations
- ✅ Conditional business logic
- ✅ Full access to product data
- ✅ Seamless integration with formula-based KPIs

**Use custom handlers when formulas can't express your business logic.**

**Both execution modes supported:**
- **In-Memory**: Real-time calculation with full logic execution
- **ClickHouse**: Query generation with explanatory comments

**Easy to extend:**
1. Add handler function
2. Add SQL explanation
3. Update config
4. Test in both modes
