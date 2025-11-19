# KPI Rebalancing Engine: Technical Guide

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Execution Modes](#execution-modes)
3. [KPI Types](#kpi-types)
4. [Dependency Resolution](#dependency-resolution)
5. [Custom Handler Deep Dive](#custom-handler-deep-dive)
6. [SQL Generation](#sql-generation)
7. [Implementation Guide](#implementation-guide)
8. [Dry Run Examples](#dry-run-examples)
9. [Workflow Generation with Allocation](#workflow-generation-with-allocation)

---

## System Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────┐
│ KPIRebalancingEngine                                        │
│                                                             │
│  ┌──────────────┐     ┌─────────────┐     ┌──────────────┐│
│  │ KPIConfig[]  │────>│ Topological │────>│ Execution    ││
│  │ (dependency  │     │ Sort        │     │ (formula or  ││
│  │  graph)      │     │ (Kahn's)    │     │  custom)     ││
│  └──────────────┘     └─────────────┘     └──────────────┘│
│         │                     │                    │        │
│         v                     v                    v        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Calculation Order: [[Level 0], [Level 1], ...]      │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```
User Edit
    │
    v
┌───────────────────────────────────────────────────────────┐
│ 1. KPIEngine.rebalance(productData, week, kpi, value)    │
│    - Clone current values                                 │
│    - Apply user edit                                      │
│    - Determine locked KPIs                                │
└───────────────────────────────────────────────────────────┘
    │
    v
┌───────────────────────────────────────────────────────────┐
│ 2. topologicalSort(configs, editedKPI, lockedKPIs)       │
│    - Build dependency graph                               │
│    - Calculate in-degrees                                 │
│    - Return levels for parallel execution                 │
└───────────────────────────────────────────────────────────┘
    │
    v
┌───────────────────────────────────────────────────────────┐
│ 3. For each level in calculation order:                  │
│    For each KPI in level:                                 │
│      if (hasCustomHandler(kpi))                          │
│        value = executeCustomHandler(...)                  │
│      else                                                 │
│        value = evaluateFormula(formula, currentValues)   │
│      Update currentValues[kpi]                           │
│      Log change                                           │
└───────────────────────────────────────────────────────────┘
    │
    v
┌───────────────────────────────────────────────────────────┐
│ 4. Handle multi-week effects                             │
│    - EOP → BOP transitions (next week)                    │
│    - Return U → Return Inv (4 weeks later)                │
└───────────────────────────────────────────────────────────┘
    │
    v
┌───────────────────────────────────────────────────────────┐
│ 5. Return RebalancingResult                              │
│    - updatedWeeks: Map<number, WeekData>                 │
│    - affectedKPIs: Set<KPIName>                          │
│    - calculationOrder: KPIName[][]                       │
│    - changes: Array of before/after values               │
│    - logs: Array of execution logs                        │
└───────────────────────────────────────────────────────────┘
```

---

## Execution Modes

### In-Memory Mode

**Mechanism:**
1. Load `ProductData` into memory (all weeks, all KPIs)
2. Execute calculations in JavaScript
3. Update in-memory values
4. Generate SQL queries for display (not executed)

**Use Cases:**
- Interactive UI demonstrations
- Real-time "what-if" analysis
- Testing KPI logic during development
- Small datasets that fit in memory

**Limitations:**
- Memory constrained (dataset size limited)
- Single-product processing
- Not suitable for batch operations

---

### ClickHouse Mode

**Mechanism:**
1. Execute calculations in JavaScript (to determine values)
2. Generate SQL queries (INSERT/UPDATE)
3. Display queries in modal (not executed in POC)
4. Can be executed against ClickHouse in deployment

**SQL Generation Types:**

**Type 1: Formula-based KPIs**
```sql
-- Simple UPDATE
UPDATE kpi_data
SET gm_dollars = sls_dollars - cogs
WHERE product_id = 'PROD-001' AND week = 10
```

**Type 2: Custom Handler - POC Mode**
```sql
-- Explanation comments + value UPDATE
-- [POC] Shows JavaScript execution with inputs/steps/output
-- Final UPDATE sets calculated value
UPDATE kpi_data
SET smart_reorder_point = 1805
WHERE product_id = 'PROD-001' AND week = 10
```

**Type 3: Custom Handler - Production SQL**
```sql
-- Executable ClickHouse query
ALTER TABLE kpi_data
UPDATE smart_reorder_point = (
  WITH historical AS (
    SELECT AVG(sls_u), stddevPop(sls_u)
    FROM kpi_data ...
  )
  SELECT round(...calculation...) FROM historical
)
WHERE product_id = 'PROD-001' AND week = 10
```

---

## KPI Types

### 1. Editable KPIs

KPIs that users can directly modify.

```typescript
{
  name: 'Sls U',
  displayName: 'Sales Units',
  isEditable: true,
  dependsOn: [],
  locksWhenEdited: ['DR%', 'Return %'],
}
```

**Properties:**
- `isEditable: true`
- No formula
- No custom handler
- May lock other KPIs when edited
- Serve as input to dependency graph

---

### 2. Formula-Based KPIs

KPIs calculated using mathematical expressions.

```typescript
{
  name: 'GM $',
  displayName: 'Gross Margin $',
  isEditable: false,
  formula: 'Sls $ - COGS',
  dependsOn: ['Sls $', 'COGS'],
  locksWhenEdited: [],
}
```

**Execution:**
```typescript
// formulas.ts - uses mathjs for evaluation
export function evaluateFormula(
  formula: string,
  values: Record<string, number>
): number {
  const scope = { ...values };
  return evaluate(formula, scope);
}

// Example
const result = evaluateFormula('Sls $ - COGS', {
  'Sls $': 12000,
  'COGS': 7200
});
// Returns: 4800
```

**Formula Operators:**
- Arithmetic: `+`, `-`, `*`, `/`
- Functions: `sqrt()`, `abs()`, `round()`, `floor()`, `ceil()`
- Logical: `>`, `<`, `>=`, `<=`, `==`, `!=`
- Conditional: `condition ? valueIfTrue : valueIfFalse`

---

### 3. Custom Handler KPIs

KPIs requiring complex logic beyond formulas.

```typescript
{
  name: 'Smart Reorder Point',
  displayName: 'Smart Reorder Point',
  isEditable: false,
  // No formula - uses custom handler
  dependsOn: ['Sls U'],
  locksWhenEdited: [],
}
```

**Execution:**
```typescript
// customKPIHandlers.ts
export const customKPIHandlers: Record<string, CustomKPIHandler> = {
  'Smart Reorder Point': (productData, week, currentValues) => {
    // Complex logic with full data access
    // Returns calculated value
  }
};
```

**When to Use:**
- Statistical calculations (variance, std deviation)
- Historical analysis (multi-week lookback)
- Forecasting (lookahead)
- Conditional business rules (complex branching)
- Intermediate steps (validation, logging, alerts)

---

## Dependency Resolution

### Topological Sort (Kahn's Algorithm)

**Purpose:** Determine calculation order for dependent KPIs.

**Algorithm Steps:**

```typescript
function topologicalSort(
  configs: Map<KPIName, KPIConfig>,
  editedKPI: KPIName,
  lockedKPIs: Set<KPIName>
): KPIName[][] {
  // 1. Build graph
  const graph = new Map<KPIName, Set<KPIName>>();
  const inDegree = new Map<KPIName, number>();

  // 2. Initialize calculable KPIs
  configs.forEach((config, kpi) => {
    // Include if has formula OR custom handler
    if (!config.formula && !hasCustomHandler(kpi)) return;
    if (lockedKPIs.has(kpi)) return;
    if (kpi === editedKPI) return;

    calculableKPIs.add(kpi);
    inDegree.set(kpi, 0);
  });

  // 3. Build edges
  calculableKPIs.forEach(kpi => {
    const config = configs.get(kpi);
    config.dependsOn.forEach(dependency => {
      graph.get(dependency).add(kpi);

      // Only increment in-degree if dependency is calculable
      if (calculableKPIs.has(dependency)) {
        inDegree.set(kpi, inDegree.get(kpi) + 1);
      }
    });
  });

  // 4. Find nodes with in-degree 0
  const queue = [];
  calculableKPIs.forEach(kpi => {
    if (inDegree.get(kpi) === 0) {
      queue.push(kpi);
    }
  });

  // 5. Process level by level
  const levels = [];
  while (queue.length > 0) {
    const currentLevel = [...queue];
    queue.length = 0;

    currentLevel.forEach(node => {
      const dependents = graph.get(node);
      dependents.forEach(dependent => {
        const newInDegree = inDegree.get(dependent) - 1;
        inDegree.set(dependent, newInDegree);

        if (newInDegree === 0) {
          queue.push(dependent);
        }
      });
    });

    levels.push(currentLevel);
  }

  return levels;
}
```

**Example:**

Given dependencies:
```
Sls U (edited)
  ├─> Sls $ (formula: Sls U * AUR)
  ├─> COGS (formula: Sls U * AUC)
  └─> Return U (formula: Return % * Sls U)

Sls $ + COGS
  └─> GM $ (formula: Sls $ - COGS)

Sls U (historical)
  └─> Smart Reorder Point (custom handler)
```

Result:
```typescript
[
  ['Sls $', 'COGS', 'Return U'],        // Level 0 - no dependencies
  ['GM $', 'Smart Reorder Point'],      // Level 1 - depend on Level 0
]
```

**Parallel Execution:**
- All KPIs in same level can execute in parallel
- Must complete level N before starting level N+1
- Ensures data consistency

---

## Custom Handler Deep Dive

### Handler Function Signature

```typescript
type CustomKPIHandler = (
  productData: ProductData,     // Full access to all weeks
  week: number,                  // Current week being calculated
  currentValues?: Record<string, number>  // Current week's KPI values
) => number;
```

### Execution Context

**Available Data:**

```typescript
// productData structure
interface ProductData {
  productId: string;
  productName: string;
  weeks: Map<number, WeekData>;
}

interface WeekData {
  week: number;
  year: number;
  values: Record<KPIName, number>;
  lastEdited?: {
    kpi: KPIName;
    timestamp: Date;
  };
}
```

**Accessing Historical Data:**

```typescript
'Your KPI': (productData, week, currentValues) => {
  // Access specific week
  const lastWeek = productData.weeks.get(week - 1);
  const lastWeekSales = lastWeek?.values['Sls U'] || 0;

  // Loop through multiple weeks
  const salesHistory = [];
  for (let i = 0; i < 4; i++) {
    const historicalWeek = productData.weeks.get(week - i);
    if (historicalWeek) {
      salesHistory.push(historicalWeek.values['Sls U']);
    }
  }

  // Access current week's updated values
  const currentGM = currentValues?.['GM $'] || 0;

  // Perform calculation
  return someCalculation(salesHistory, currentGM);
}
```

### Execution Logging

**Purpose:** Track inputs, intermediate steps, and output for audit trail.

**Implementation:**

```typescript
// Inside custom handler
const log: CustomKPIExecutionLog = {
  kpiName: 'Smart Reorder Point',
  week,
  productId: productData.productId,
  inputs: {},
  intermediateSteps: [],
  output: 0,
  timestamp: new Date(),
};

// Capture inputs
log.inputs['Week 10 Sls U'] = slsU;
log.inputs['Week 9 Sls U'] = slsU_prev;

// Capture intermediate calculations
const avgDemand = (slsU + slsU_prev) / 2;
log.intermediateSteps.push({
  step: 'Average Demand',
  value: avgDemand
});

const safetyStock = 1.645 * stdDev * sqrt(2);
log.intermediateSteps.push({
  step: 'Safety Stock (95%)',
  value: safetyStock
});

// Capture output
const reorderPoint = avgDemand * 2 + safetyStock;
log.output = reorderPoint;

// Store log
executionLogs.push(log);

return reorderPoint;
```

### Example: Smart Reorder Point

**Business Logic:**
1. Calculate average demand (4-week lookback)
2. Calculate standard deviation (variance)
3. Calculate lead time demand (2 weeks)
4. Calculate safety stock (Z-score * σ * √lead_time)
5. Apply seasonal adjustment (compare to 8 weeks ago)
6. Return: (lead_time_demand * seasonal) + safety_stock

**Implementation:**

```typescript
'Smart Reorder Point': (productData, week) => {
  const LEAD_TIME_WEEKS = 2;
  const SERVICE_LEVEL_Z = 1.645; // 95% service level
  const LOOKBACK_WEEKS = 4;

  const weekData = productData.weeks.get(week);
  if (!weekData) return 0;

  const log: CustomKPIExecutionLog = {
    kpiName: 'Smart Reorder Point',
    week,
    productId: productData.productId,
    inputs: {},
    intermediateSteps: [],
    output: 0,
    timestamp: new Date(),
  };

  // Step 1: Gather sales history
  const salesHistory: number[] = [];
  for (let i = 0; i < LOOKBACK_WEEKS; i++) {
    const historicalWeek = productData.weeks.get(week - i);
    if (historicalWeek) {
      const slsU = historicalWeek.values['Sls U'];
      salesHistory.push(slsU);
      log.inputs[`Week ${week - i} Sls U`] = slsU;
    }
  }

  if (salesHistory.length === 0) return 0;

  // Step 2: Calculate average demand
  const avgDemand = salesHistory.reduce((sum, s) => sum + s, 0) / salesHistory.length;
  log.intermediateSteps.push({ step: 'Average Demand (4-week)', value: avgDemand });

  // Step 3: Calculate standard deviation
  const variance = salesHistory.reduce(
    (sum, s) => sum + Math.pow(s - avgDemand, 2),
    0
  ) / salesHistory.length;
  const stdDev = Math.sqrt(variance);
  log.intermediateSteps.push({ step: 'Standard Deviation', value: stdDev });
  log.intermediateSteps.push({ step: 'Variance', value: variance });

  // Step 4: Calculate lead time demand
  const leadTimeDemand = avgDemand * LEAD_TIME_WEEKS;
  log.intermediateSteps.push({
    step: `Lead Time Demand (${LEAD_TIME_WEEKS} weeks)`,
    value: leadTimeDemand
  });

  // Step 5: Calculate safety stock
  const safetyStock = SERVICE_LEVEL_Z * stdDev * Math.sqrt(LEAD_TIME_WEEKS);
  log.intermediateSteps.push({
    step: 'Safety Stock (95% service level)',
    value: safetyStock
  });

  // Step 6: Seasonal adjustment
  let seasonalFactor = 1.0;
  const sameWeekLastCycle = productData.weeks.get(week - 8);
  if (sameWeekLastCycle && avgDemand > 0) {
    const lastCycleSales = sameWeekLastCycle.values['Sls U'];
    log.inputs[`Week ${week - 8} Sls U (seasonal)`] = lastCycleSales;

    seasonalFactor = lastCycleSales / avgDemand;
    const uncappedFactor = seasonalFactor;
    seasonalFactor = Math.max(0.8, Math.min(1.5, seasonalFactor));

    log.intermediateSteps.push({
      step: 'Seasonal Factor (uncapped)',
      value: uncappedFactor
    });
    log.intermediateSteps.push({
      step: 'Seasonal Factor (capped 0.8-1.5)',
      value: seasonalFactor
    });
  } else {
    log.intermediateSteps.push({ step: 'Seasonal Factor (no data)', value: 1.0 });
  }

  // Step 7: Calculate reorder point
  const reorderPoint = leadTimeDemand * seasonalFactor + safetyStock;
  log.intermediateSteps.push({
    step: 'Reorder Point (before rounding)',
    value: reorderPoint
  });

  const finalValue = Math.round(reorderPoint);
  log.output = finalValue;

  executionLogs.push(log);

  return finalValue;
}
```

### Intermediate Steps (Side Effects)

Custom handlers can execute logic that doesn't update KPIs:

```typescript
'Inventory Alert KPI': (productData, week, currentValues) => {
  const currentInventory = currentValues?.['EOP U'] || 0;
  const reorderPoint = currentValues?.['Smart Reorder Point'] || 0;

  // STEP 1: Data validation (no KPI update)
  if (currentInventory < 0) {
    logError({
      type: 'data-quality-issue',
      product: productData.productId,
      week,
      message: 'Negative inventory detected',
      value: currentInventory
    });
    return 0; // Don't calculate if data is invalid
  }

  // STEP 2: Alert logic (no KPI update)
  if (currentInventory < reorderPoint * 0.5) {
    sendAlert({
      severity: 'HIGH',
      product: productData.productId,
      week,
      message: `Critical: Inventory ${currentInventory} < 50% of reorder point ${reorderPoint}`
    });
  } else if (currentInventory < reorderPoint) {
    sendAlert({
      severity: 'MEDIUM',
      product: productData.productId,
      week,
      message: `Warning: Inventory below reorder point`
    });
  }

  // STEP 3: Analytics tracking (no KPI update)
  trackMetric('inventory_coverage', {
    product: productData.productId,
    week,
    inventory: currentInventory,
    reorder_point: reorderPoint,
    coverage_ratio: currentInventory / reorderPoint,
    status: currentInventory < reorderPoint ? 'below' : 'above'
  });

  // STEP 4: Return actual KPI value
  const coverageDays = (currentInventory / currentValues?.['Sls U']) * 7;
  return Math.round(coverageDays);
}
```

---

## SQL Generation

### Formula-Based KPIs

**Direct Translation:**

```typescript
// KPI Config
{
  name: 'GM $',
  formula: 'Sls $ - COGS',
  dependsOn: ['Sls $', 'COGS']
}

// Generated SQL
ALTER TABLE kpi_data
UPDATE gm_dollars = sls_dollars - cogs
WHERE product_id = {productId:String}
  AND week = {week:UInt8}
```

### Custom Handler KPIs - POC Mode

**Explanation Comments + Value UPDATE:**

```sql
-- POC EXPLANATION: Smart Reorder Point
-- This KPI uses custom handler with JavaScript execution
--
-- INPUTS (from execution):
--   Week 10 Sls U = 1200
--   Week 9 Sls U = 95
--   Week 8 Sls U = 90
--   Week 7 Sls U = 85
--   Week 2 Sls U (seasonal) = 80
--
-- INTERMEDIATE CALCULATIONS:
--   1. Average Demand (4-week) = 367.5
--   2. Standard Deviation = 522.8
--   3. Variance = 273280
--   4. Lead Time Demand (2 weeks) = 735
--   5. Safety Stock (95% service level) = 1216.7
--   6. Seasonal Factor (uncapped) = 0.218
--   7. Seasonal Factor (capped 0.8-1.5) = 0.8
--   8. Reorder Point (before rounding) = 1804.7
--
-- OUTPUT: 1805
--
-- The actual calculation was performed in JavaScript
-- This UPDATE sets the calculated value

ALTER TABLE kpi_data
UPDATE smart_reorder_point = {newValue:Float64}
WHERE product_id = {productId:String}
  AND week = {week:UInt8}
```

### Custom Handler KPIs - Production SQL

**Executable ClickHouse Query:**

```sql
-- PRODUCTION SQL: Smart Reorder Point
-- Statistical reorder point with variance, safety stock, and seasonality
-- Designed for large datasets - executes entirely in ClickHouse
--
-- Explanation:
-- 1. Calculate historical statistics (avg, stddev) from last 4 weeks
-- 2. Get seasonal sales from 8 weeks ago
-- 3. Calculate lead time demand (avg * 2 weeks)
-- 4. Calculate safety stock (1.645 * stddev * sqrt(2)) for 95% service level
-- 5. Calculate seasonal factor (ratio of 8-week-ago sales to avg, capped 0.8-1.5)
-- 6. Final formula: (lead_time_demand * seasonal_factor) + safety_stock
--
ALTER TABLE kpi_data
UPDATE smart_reorder_point = (
  WITH
  historical AS (
    SELECT
      AVG(sls_u) as avg_demand,
      stddevPop(sls_u) as std_dev
    FROM kpi_data
    WHERE product_id = 'PROD-001'
      AND year = 2024
      AND week >= 6 AND week < 10
  ),
  seasonal AS (
    SELECT sls_u as seasonal_sales
    FROM kpi_data
    WHERE product_id = 'PROD-001' AND year = 2024 AND week = 2
    LIMIT 1
  ),
  components AS (
    SELECT
      h.avg_demand,
      h.std_dev,
      h.avg_demand * 2 as lead_time_demand,
      1.645 * h.std_dev * sqrt(2) as safety_stock,
      CASE
        WHEN h.avg_demand = 0 THEN 1.0
        ELSE greatest(0.8, least(1.5, s.seasonal_sales / h.avg_demand))
      END as seasonal_factor
    FROM historical h
    CROSS JOIN seasonal s
  )
  SELECT round(lead_time_demand * seasonal_factor + safety_stock)
  FROM components
)
WHERE product_id = 'PROD-001'
  AND year = 2024
  AND week = 10
```

**SQL Generation Logic:**

```typescript
// Check if production SQL is available
if (hasProductionSQL(log.kpi)) {
  // Generate executable SQL
  const productionSQL = getProductionSQL(log.kpi, productId, log.week, year);
  queries.push({
    sql: formatProductionSQL(productionSQL),
    description: `[PRODUCTION] ${log.kpi} calculation`
  });
} else {
  // Generate POC explanation + value UPDATE
  const explanation = generateCustomHandlerExplanation(log.kpi, ...);
  queries.push(explanation);
  queries.push(generateUpdateSingleKPIQuery(productId, week, kpi, value));
}
```

---

## Implementation Guide

### Adding a New Formula-Based KPI

**Step 1: Define Config**

```typescript
// src/data/kpiConfig.ts
{
  name: 'Net GM $',
  displayName: 'Net Gross Margin $',
  isEditable: false,
  formula: '(Net Sls $ - COGS) + Return $',
  dependsOn: ['Net Sls $', 'COGS', 'Return $'],
  locksWhenEdited: [],
  description: 'Gross margin after returns',
}
```

**Step 2: Add Type**

```typescript
// src/types.ts
export type KPIName =
  | 'Sls U'
  | 'Sls $'
  // ... existing KPIs
  | 'Net GM $';  // Add here
```

**Step 3: Add Column Mapping**

```typescript
// src/services/clickhouse-query-service.ts
const KPI_COLUMN_MAP: Record<string, string> = {
  'Sls U': 'sls_u',
  // ... existing mappings
  'Net GM $': 'net_gm_dollars',  // Add here
};
```

**Step 4: Add to Initial Data**

```typescript
// src/data/initialData.ts
function generateWeekValues(weekNum: number): Record<KPIName, number> {
  // ... existing calculations
  const netGMDollars = netSlsDollars - cogs + returnDollars;

  return {
    'Sls U': baseSlsU,
    // ... existing KPIs
    'Net GM $': netGMDollars,  // Add here
  };
}
```

Done! The KPI will now:
- Appear in the grid
- Recalculate automatically when dependencies change
- Generate SQL queries in ClickHouse mode
- Work with dependency highlighting

---

### Adding a New Custom Handler KPI

**Step 1: Define Config**

```typescript
// src/data/kpiConfig.ts
{
  name: 'Demand Volatility Index',
  displayName: 'Demand Volatility Index',
  isEditable: false,
  // No formula - uses custom handler
  dependsOn: ['Sls U'],
  locksWhenEdited: [],
  description: 'Coefficient of variation for demand (custom calculation)',
}
```

**Step 2: Add Type**

```typescript
// src/types.ts
export type KPIName =
  | 'Sls U'
  // ... existing KPIs
  | 'Demand Volatility Index';
```

**Step 3: Implement Handler**

```typescript
// src/engine/customKPIHandlers.ts
export const customKPIHandlers: Record<string, CustomKPIHandler> = {
  // ... existing handlers

  'Demand Volatility Index': (productData, week) => {
    const LOOKBACK_WEEKS = 8;

    const log: CustomKPIExecutionLog = {
      kpiName: 'Demand Volatility Index',
      week,
      productId: productData.productId,
      inputs: {},
      intermediateSteps: [],
      output: 0,
      timestamp: new Date(),
    };

    // Gather sales history
    const salesHistory: number[] = [];
    for (let i = 0; i < LOOKBACK_WEEKS; i++) {
      const historicalWeek = productData.weeks.get(week - i);
      if (historicalWeek) {
        const slsU = historicalWeek.values['Sls U'];
        salesHistory.push(slsU);
        log.inputs[`Week ${week - i} Sls U`] = slsU;
      }
    }

    if (salesHistory.length < 2) return 0;

    // Calculate mean
    const mean = salesHistory.reduce((sum, s) => sum + s, 0) / salesHistory.length;
    log.intermediateSteps.push({ step: 'Mean', value: mean });

    // Calculate standard deviation
    const variance = salesHistory.reduce(
      (sum, s) => sum + Math.pow(s - mean, 2),
      0
    ) / salesHistory.length;
    const stdDev = Math.sqrt(variance);
    log.intermediateSteps.push({ step: 'Std Deviation', value: stdDev });

    // Coefficient of variation (CV = stdDev / mean)
    const cv = mean === 0 ? 0 : (stdDev / mean) * 100;
    log.intermediateSteps.push({ step: 'CV (%)', value: cv });

    // Classify volatility
    let classification = 'Low';
    if (cv > 50) classification = 'High';
    else if (cv > 25) classification = 'Medium';
    log.intermediateSteps.push({ step: 'Classification', value: classification });

    log.output = cv;
    executionLogs.push(log);

    return cv;
  },
};
```

**Step 4: (Optional) Add Production SQL**

```typescript
// src/engine/customKPIProductionSQL.ts
function generateDemandVolatilitySQL(
  productId: string,
  week: number,
  year: number
): ProductionSQL {
  return {
    kpiName: 'Demand Volatility Index',
    description: 'Coefficient of variation for 8-week sales',
    requiresMultiQuery: false,
    sql: `
ALTER TABLE kpi_data
UPDATE demand_volatility_index = (
  WITH historical AS (
    SELECT
      AVG(sls_u) as mean,
      stddevPop(sls_u) as std_dev
    FROM kpi_data
    WHERE product_id = {productId:String}
      AND year = {year:UInt16}
      AND week >= {week:UInt8} - 8
      AND week < {week:UInt8}
  )
  SELECT
    CASE
      WHEN mean = 0 THEN 0
      ELSE (std_dev / mean) * 100
    END as cv
  FROM historical
)
WHERE product_id = {productId:String}
  AND year = {year:UInt16}
  AND week = {week:UInt8}
`,
    explanation: [
      'Calculate mean and std deviation over 8 weeks',
      'Compute coefficient of variation: (stdDev / mean) * 100',
      'Returns percentage representing demand volatility',
    ],
    parameters: { productId, week, year },
  };
}

// Register in getProductionSQL
export function getProductionSQL(kpiName, productId, week, year) {
  switch (kpiName) {
    case 'Demand Volatility Index':
      return generateDemandVolatilitySQL(productId, week, year);
    // ... other cases
  }
}
```

**Step 5: Add to Column Mapping and Initial Data**

(Same as formula-based KPI steps 3-4)

Done! Custom handler KPI is integrated.

---

## Dry Run Examples

### Example 1: Simple Formula Edit

**Initial State:**

```
Week 10:
  Sls U: 100
  AUR: 10
  Sls $: 1000
  AUC: 6
  COGS: 600
  GM $: 400
```

**User Action:** Edit Sls U = 150

**Execution Trace:**

```
1. KPIEngine.rebalance(productData, week=10, kpi='Sls U', value=150)

2. Clone current values
   currentValues = { 'Sls U': 100, 'AUR': 10, 'Sls $': 1000, ... }

3. Apply edit
   currentValues['Sls U'] = 150
   Log: [user-edit] Sls U: 100 → 150

4. Get lock strategy
   editConfig = configs.get('Sls U')
   lockedKPIs = Set(['DR%', 'Return %'])  // From config.locksWhenEdited

5. Topological sort
   calculationOrder = topologicalSort(configs, 'Sls U', lockedKPIs)
   Result: [
     ['Sls $', 'COGS'],  // Level 0
     ['GM $'],           // Level 1
   ]

6. Execute Level 0
   For 'Sls $':
     oldValue = 1000
     newValue = evaluateFormula('Sls U * AUR', currentValues)
              = evaluateFormula('Sls U * AUR', { 'Sls U': 150, 'AUR': 10, ... })
              = 150 * 10
              = 1500
     currentValues['Sls $'] = 1500
     Log: [system-recalc] Sls $: 1000 → 1500 (Level 1, formula: 'Sls U * AUR')

   For 'COGS':
     oldValue = 600
     newValue = evaluateFormula('Sls U * AUC', currentValues)
              = 150 * 6
              = 900
     currentValues['COGS'] = 900
     Log: [system-recalc] COGS: 600 → 900 (Level 1, formula: 'Sls U * AUC')

7. Execute Level 1
   For 'GM $':
     oldValue = 400
     newValue = evaluateFormula('Sls $ - COGS', currentValues)
              = evaluateFormula('Sls $ - COGS', { 'Sls $': 1500, 'COGS': 900, ... })
              = 1500 - 900
              = 600
     currentValues['GM $'] = 600
     Log: [system-recalc] GM $: 400 → 600 (Level 2, formula: 'Sls $ - COGS')

8. Update week data
   updatedWeeks.set(10, { week: 10, values: currentValues, ... })

9. Return result
   {
     updatedWeeks: Map(1) { 10 => WeekData },
     affectedKPIs: Set(['Sls U', 'Sls $', 'COGS', 'GM $']),
     calculationOrder: [['Sls $', 'COGS'], ['GM $']],
     changes: [
       { week: 10, kpi: 'Sls U', oldValue: 100, newValue: 150 },
       { week: 10, kpi: 'Sls $', oldValue: 1000, newValue: 1500 },
       { week: 10, kpi: 'COGS', oldValue: 600, newValue: 900 },
       { week: 10, kpi: 'GM $', oldValue: 400, newValue: 600 },
     ],
     logs: [4 log entries]
   }
```

**Final State:**

```
Week 10:
  Sls U: 150  ✓ (edited)
  AUR: 10
  Sls $: 1500  ✓ (recalculated)
  AUC: 6
  COGS: 900  ✓ (recalculated)
  GM $: 600  ✓ (recalculated)
```

---

### Example 2: Custom Handler with Historical Data

**Initial State:**

```
Week 7: Sls U = 85
Week 8: Sls U = 90
Week 9: Sls U = 95
Week 10: Sls U = 100, Smart Reorder Point = 250
```

**User Action:** Edit Sls U = 200 (week 10)

**Execution Trace:**

```
1. KPIEngine.rebalance(productData, week=10, kpi='Sls U', value=200)

2. Apply edit
   currentValues['Sls U'] = 200

3. Topological sort
   calculationOrder = [
     ['Sls $', 'COGS'],
     ['GM $', 'Smart Reorder Point'],  // Custom handler in Level 1
   ]

4. Execute Level 0 (formulas)
   Sls $ = 200 * 10 = 2000
   COGS = 200 * 6 = 1200

5. Execute Level 1 - GM $ (formula)
   GM $ = 2000 - 1200 = 800

6. Execute Level 1 - Smart Reorder Point (CUSTOM HANDLER)

   hasCustomHandler('Smart Reorder Point') → TRUE

   executeCustomHandler('Smart Reorder Point', productData, 10, currentValues)

   Inside handler:

   a) Gather historical data (4-week lookback)
      week 10: Sls U = 200 (current, just edited)
      week 9:  Sls U = 95
      week 8:  Sls U = 90
      week 7:  Sls U = 85
      salesHistory = [200, 95, 90, 85]

      Log inputs:
        'Week 10 Sls U' = 200
        'Week 9 Sls U' = 95
        'Week 8 Sls U' = 90
        'Week 7 Sls U' = 85

   b) Calculate average demand
      avgDemand = (200 + 95 + 90 + 85) / 4 = 117.5

      Log step: 'Average Demand (4-week)' = 117.5

   c) Calculate standard deviation
      variance = (
        (200 - 117.5)² +
        (95 - 117.5)² +
        (90 - 117.5)² +
        (85 - 117.5)²
      ) / 4
      = (6806.25 + 506.25 + 756.25 + 1056.25) / 4
      = 9125 / 4
      = 2281.25

      stdDev = √2281.25 = 47.76

      Log steps:
        'Variance' = 2281.25
        'Standard Deviation' = 47.76

   d) Calculate lead time demand (2 weeks)
      leadTimeDemand = 117.5 * 2 = 235

      Log step: 'Lead Time Demand (2 weeks)' = 235

   e) Calculate safety stock (95% service level, Z = 1.645)
      safetyStock = 1.645 * 47.76 * √2
                  = 1.645 * 47.76 * 1.414
                  = 111.1

      Log step: 'Safety Stock (95% service level)' = 111.1

   f) Seasonal adjustment (compare to 8 weeks ago)
      week 2 Sls U = 80 (from productData.weeks.get(2))
      seasonalFactor = 80 / 117.5 = 0.681
      capped = Math.max(0.8, Math.min(1.5, 0.681)) = 0.8 (capped at minimum)

      Log inputs:
        'Week 2 Sls U (seasonal)' = 80
      Log steps:
        'Seasonal Factor (uncapped)' = 0.681
        'Seasonal Factor (capped 0.8-1.5)' = 0.8

   g) Calculate reorder point
      reorderPoint = leadTimeDemand * seasonalFactor + safetyStock
                   = 235 * 0.8 + 111.1
                   = 188 + 111.1
                   = 299.1

      Log step: 'Reorder Point (before rounding)' = 299.1

   h) Round and return
      finalValue = Math.round(299.1) = 299

      Log output: 299

      Return: 299

   currentValues['Smart Reorder Point'] = 299

   Log: [system-recalc] Smart Reorder Point: 250 → 299
        (Level 2, formula: '[Custom Handler: Smart Reorder Point]')

7. Return result with logs
```

**Final State:**

```
Week 7: Sls U = 85
Week 8: Sls U = 90
Week 9: Sls U = 95
Week 10:
  Sls U = 200  ✓ (edited)
  Sls $ = 2000  ✓ (recalculated)
  COGS = 1200  ✓ (recalculated)
  GM $ = 800  ✓ (recalculated)
  Smart Reorder Point = 299  ✓ (custom handler executed)
```

**Execution Log Available:**

```javascript
getLatestExecutionLog('Smart Reorder Point')
// Returns:
{
  kpiName: 'Smart Reorder Point',
  week: 10,
  productId: 'PROD-001',
  inputs: {
    'Week 10 Sls U': 200,
    'Week 9 Sls U': 95,
    'Week 8 Sls U': 90,
    'Week 7 Sls U': 85,
    'Week 2 Sls U (seasonal)': 80
  },
  intermediateSteps: [
    { step: 'Average Demand (4-week)', value: 117.5 },
    { step: 'Standard Deviation', value: 47.76 },
    { step: 'Variance', value: 2281.25 },
    { step: 'Lead Time Demand (2 weeks)', value: 235 },
    { step: 'Safety Stock (95% service level)', value: 111.1 },
    { step: 'Seasonal Factor (uncapped)', value: 0.681 },
    { step: 'Seasonal Factor (capped 0.8-1.5)', value: 0.8 },
    { step: 'Reorder Point (before rounding)', value: 299.1 }
  ],
  output: 299,
  timestamp: Date(...)
}
```

---

### Example 3: Multi-Week Effects

**Initial State:**

```
Week 10:
  Return U = 10

Week 14:
  Return Inv = 0  (4 weeks after week 10)
```

**User Action:** Edit Return % = 0.15 (week 10, causes Return U to recalculate)

**Execution Trace:**

```
1. Edit Return % → triggers Return U recalculation
   Return U = evaluateFormula('Return % * Sls U', currentValues)
            = 0.15 * 100
            = 15

   currentValues['Return U'] = 15

2. After linear calculations complete, handleMultiWeekEffects() called

3. Check affectedKPIs
   affectedKPIs.has('Return U') → TRUE

4. handleReturnInventory(productData, week=10, currentValues, ...)

   a) Get return units
      returnUnits = currentValues['Return U'] = 15

   b) Calculate future inventory (90% survive, 10% damage rate)
      futureInventory = 15 * (1 - 0.1) = 15 * 0.9 = 13.5

   c) Update week 14 (10 + 4)
      futureWeek = productData.weeks.get(14)
      oldReturnInv = futureWeek.values['Return Inv'] = 0

      futureWeek.values['Return Inv'] = 13.5
      updatedWeeks.set(14, futureWeek)

      changes.push({
        week: 14,
        kpi: 'Return Inv',
        oldValue: 0,
        newValue: 13.5
      })

   d) Recalculate EOP U for week 14 (since Return Inv changed)
      EOP U = BOP U - Sls U + Total Rcpt U + Return Inv

      Week 14:
        oldEOP = 440
        newEOP = 500 - 100 + 50 + 13.5 = 463.5

        changes.push({
          week: 14,
          kpi: 'EOP U',
          oldValue: 440,
          newValue: 463.5
        })

5. Return result with changes to TWO weeks
```

**Final State:**

```
Week 10:
  Return % = 0.15  ✓ (edited)
  Return U = 15  ✓ (recalculated)

Week 14:
  Return Inv = 13.5  ✓ (multi-week effect)
  EOP U = 463.5  ✓ (cascade from Return Inv)
```

**Changes Array:**

```javascript
[
  { week: 10, kpi: 'Return %', oldValue: 0.1, newValue: 0.15 },
  { week: 10, kpi: 'Return U', oldValue: 10, newValue: 15 },
  { week: 14, kpi: 'Return Inv', oldValue: 0, newValue: 13.5 },
  { week: 14, kpi: 'EOP U', oldValue: 440, newValue: 463.5 },
]
```

---

## Workflow Generation with Allocation

### Overview

For production deployments, the KPI rebalancing engine generates workflow definitions that external frameworks can execute. Workflows support two types of edits:

1. **Single-Product Edits**: Direct update at granular level (product-week)
2. **Aggregated Edits**: Edit at aggregated level (dept-month), distribute to granular level (product-week)

### Workflow Structure

```typescript
interface WorkflowDefinition {
  workflow_id: string;
  description: string;
  steps: WorkflowStep[];
  memory_limits: {
    max_memory_mb: number;
    cleanup_threshold_mb: number;
  };
  max_parallel_steps: number;
  timeout_seconds: number;
}

interface WorkflowStep {
  step_id: string;
  description: string;
  source_table: string;
  target_table: string;
  process_sql: string;
  cleanup_source: boolean;      // Whether to drop source table after execution
  dependencies: string[];        // step_id values that must complete first
}
```

### Single-Product Edit Workflow

**Scenario:** User edits "Product P001, Week 14, 2024, Sls U = 150"

**Generated Workflow:**

```json
{
  "workflow_id": "edit_Sls_U_1637152923",
  "description": "Edit Sls U for single product and rebalance",
  "steps": [
    {
      "step_id": "edit_Sls_U_1637152923_apply_edit",
      "description": "Update Sls U for product P001",
      "source_table": "kpi_data",
      "target_table": "kpi_data",
      "process_sql": "ALTER TABLE kpi_data UPDATE sls_u = 150 WHERE product_id = 'P001' AND year = 2024 AND week = 14",
      "cleanup_source": false,
      "dependencies": []
    },
    {
      "step_id": "edit_Sls_U_1637152923_rebalance_GM_$_L0",
      "description": "Rebalance GM $ using formula: Sls $ - COGS",
      "source_table": "kpi_data",
      "target_table": "kpi_data",
      "process_sql": "ALTER TABLE kpi_data UPDATE gm_d = divide(sls_d, cogs) WHERE product_id = 'P001' AND year = 2024 AND week = 14",
      "cleanup_source": false,
      "dependencies": ["edit_Sls_U_1637152923_apply_edit"]
    }
  ],
  "memory_limits": { "max_memory_mb": 512, "cleanup_threshold_mb": 384 },
  "max_parallel_steps": 4,
  "timeout_seconds": 120
}
```

### Aggregated Edit Workflow

**Scenario:** User edits "Electronics Dept, January 2024, Sls U = 50,000"

**Current State:**
- Total current Sls U for Electronics in Jan 2024: 48,000
- Delta to distribute: +2,000
- Distribution strategy: Pro-rata (proportional to current values)

**Generated Workflow:**

```json
{
  "workflow_id": "edit_Sls_U_1637152924",
  "description": "Edit Sls U at aggregated level and rebalance dependent KPIs",
  "steps": [
    {
      "step_id": "edit_Sls_U_1637152924_calculate_current",
      "description": "Calculate current aggregate value before edit",
      "source_table": "kpi_data",
      "target_table": "tmp_edit_Sls_U_1637152924_current_aggregate",
      "process_sql": "SELECT toMonth(...) as time_group, dept, SUM(sls_u) as current_value FROM kpi_data WHERE dept = 'Electronics' AND ... GROUP BY time_group, dept",
      "cleanup_source": false,
      "dependencies": []
    },
    {
      "step_id": "edit_Sls_U_1637152924_calculate_weights",
      "description": "Calculate allocation weights using pro_rata strategy",
      "source_table": "kpi_data",
      "target_table": "tmp_edit_Sls_U_1637152924_weights",
      "process_sql": "WITH granular_values AS (...) SELECT product_id, week, year, weight FROM ...",
      "cleanup_source": false,
      "dependencies": []
    },
    {
      "step_id": "edit_Sls_U_1637152924_calculate_deltas",
      "description": "Calculate delta to distribute across granular level",
      "source_table": "tmp_edit_Sls_U_1637152924_current_aggregate",
      "target_table": "tmp_edit_Sls_U_1637152924_deltas",
      "process_sql": "SELECT w.product_id, w.week, w.year, (50000 - a.current_value) * w.weight as delta FROM tmp_..._weights w CROSS JOIN tmp_..._current_aggregate a",
      "cleanup_source": true,
      "dependencies": ["edit_Sls_U_1637152924_calculate_current", "edit_Sls_U_1637152924_calculate_weights"]
    },
    {
      "step_id": "edit_Sls_U_1637152924_apply_edits",
      "description": "Apply distributed edits to Sls U",
      "source_table": "tmp_edit_Sls_U_1637152924_deltas",
      "target_table": "kpi_data",
      "process_sql": "ALTER TABLE kpi_data UPDATE sls_u = sls_u + (SELECT delta FROM tmp_..._deltas WHERE ...) WHERE EXISTS (...)",
      "cleanup_source": true,
      "dependencies": ["edit_Sls_U_1637152924_calculate_deltas"]
    },
    {
      "step_id": "edit_Sls_U_1637152924_rebalance_GM_$_L0",
      "description": "Rebalance GM $ using formula: Sls $ - COGS",
      "source_table": "kpi_data",
      "target_table": "kpi_data",
      "process_sql": "ALTER TABLE kpi_data UPDATE gm_d = divide(sls_d, cogs) WHERE dept = 'Electronics' AND ...",
      "cleanup_source": false,
      "dependencies": ["edit_Sls_U_1637152924_apply_edits"]
    }
  ],
  "memory_limits": { "max_memory_mb": 2048, "cleanup_threshold_mb": 1536 },
  "max_parallel_steps": 4,
  "timeout_seconds": 300
}
```

### Allocation Strategies

All allocation strategies are config-driven. The system supports 5 strategies:

#### 1. Pro-Rata (Proportional)

**Use Case:** Distribute delta proportionally to current values.

**Config:**
```typescript
{
  strategy: 'pro_rata',
  aggregation: {
    time: { editLevel: 'month', storageLevel: 'week', mapping: { sqlExpression: 'toMonth(...)' } },
    hierarchy: { editLevel: ['dept'], storageLevel: ['product_id', 'dept'] },
    where: "dept = 'Electronics' AND month = 1"
  },
  distribution: { granularity: ['product_id', 'week', 'year'] }
}
```

**SQL Logic:**
```sql
-- Calculate weights proportional to current values
WITH granular_values AS (
  SELECT product_id, week, sls_u as current_value
  FROM kpi_data
  WHERE dept = 'Electronics' AND month = 1
),
totals AS (
  SELECT SUM(current_value) as total_value FROM granular_values
)
SELECT
  g.product_id,
  g.week,
  CASE WHEN t.total_value = 0 THEN 0 ELSE g.current_value / t.total_value END as weight
FROM granular_values g
CROSS JOIN totals t
```

**Example:**
- Product P001, Week 1: Current = 100, Weight = 100/2000 = 0.05
- Product P002, Week 1: Current = 200, Weight = 200/2000 = 0.10
- Delta = +2000
- P001 gets: 2000 * 0.05 = +100 → New value = 200
- P002 gets: 2000 * 0.10 = +200 → New value = 400

#### 2. Equal Distribution

**Use Case:** Distribute delta evenly across all granular records.

**Config:**
```typescript
{
  strategy: 'equal',
  // ... same aggregation/distribution config
}
```

**SQL Logic:**
```sql
-- Each record gets equal weight
WITH counts AS (
  SELECT COUNT(*) as record_count
  FROM kpi_data
  WHERE dept = 'Electronics' AND month = 1
)
SELECT
  product_id,
  week,
  1.0 / c.record_count as weight
FROM kpi_data
CROSS JOIN counts c
WHERE dept = 'Electronics' AND month = 1
```

**Example:**
- 20 product-week records
- Delta = +2000
- Each record gets: 2000 / 20 = +100

#### 3. Historical Patterns

**Use Case:** Distribute based on historical sales patterns from previous years.

**Config:**
```typescript
{
  strategy: 'historical',
  aggregation: { /* ... */ },
  distribution: { /* ... */ },
  historical: {
    lookbackYears: 2,        // Use data from 2022, 2023
    sameTimePeriod: true     // Match same month/quarter
  }
}
```

**SQL Logic:**
```sql
-- Calculate weights from historical averages
WITH historical_values AS (
  SELECT
    product_id,
    week,
    AVG(sls_u) as avg_historical_value
  FROM kpi_data
  WHERE dept = 'Electronics'
    AND year IN (2022, 2023)
    AND month = 1
  GROUP BY product_id, week
),
totals AS (
  SELECT SUM(avg_historical_value) as total_value FROM historical_values
)
SELECT
  h.product_id,
  h.week,
  h.avg_historical_value / t.total_value as weight
FROM historical_values h
CROSS JOIN totals t
```

**Example:**
- P001, Week 1: Historical avg = 150, Weight = 150/3000 = 0.05
- P002, Week 1: Historical avg = 300, Weight = 300/3000 = 0.10
- Distribution follows historical patterns

#### 4. Weighted (Priority-Based)

**Use Case:** Assign priority weights to product tiers or categories.

**Config:**
```typescript
{
  strategy: 'weighted',
  aggregation: { /* ... */ },
  distribution: { /* ... */ },
  weights: {
    column: 'product_tier',
    mapping: {
      'A': 3.0,   // A-tier gets 3x weight
      'B': 2.0,   // B-tier gets 2x weight
      'C': 1.0    // C-tier gets 1x weight
    }
  }
}
```

**SQL Logic:**
```sql
-- Assign weights based on tier
WITH weighted_records AS (
  SELECT
    product_id,
    week,
    CASE
      WHEN product_tier = 'A' THEN 3.0
      WHEN product_tier = 'B' THEN 2.0
      WHEN product_tier = 'C' THEN 1.0
      ELSE 1.0
    END as raw_weight
  FROM kpi_data
  WHERE dept = 'Electronics' AND month = 1
),
totals AS (
  SELECT SUM(raw_weight) as total_weight FROM weighted_records
)
SELECT
  w.product_id,
  w.week,
  w.raw_weight / t.total_weight as weight
FROM weighted_records w
CROSS JOIN totals t
```

**Example:**
- 5 A-tier products, 10 B-tier, 5 C-tier
- Total weight = (5*3) + (10*2) + (5*1) = 15 + 20 + 5 = 40
- A-tier product gets: weight = 3/40 = 0.075
- B-tier product gets: weight = 2/40 = 0.05
- C-tier product gets: weight = 1/40 = 0.025

#### 5. Custom SQL

**Use Case:** Complex business logic combining multiple factors.

**Config:**
```typescript
{
  strategy: 'custom',
  aggregation: { /* ... */ },
  distribution: { /* ... */ },
  customWeightSQL: `
    -- Blend historical patterns with seasonal factors
    WITH historical AS (
      SELECT product_id, week, AVG(sls_u) as avg_sls
      FROM kpi_data WHERE year IN (2022, 2023)
      GROUP BY product_id, week
    ),
    seasonal_factors AS (
      SELECT week,
        CASE
          WHEN week BETWEEN 1 AND 13 THEN 0.8
          WHEN week BETWEEN 14 AND 26 THEN 1.0
          WHEN week BETWEEN 27 AND 39 THEN 1.2
          ELSE 1.5
        END as seasonal_factor
      FROM (SELECT DISTINCT week FROM kpi_data)
    )
    SELECT
      h.product_id,
      h.week,
      (h.avg_sls * s.seasonal_factor) / SUM(h.avg_sls * s.seasonal_factor) OVER () as weight
    FROM historical h
    JOIN seasonal_factors s ON h.week = s.week
  `
}
```

### Time Aggregation

**Mapping Edit Level to Storage Level:**

```typescript
interface TimeAggregation {
  editLevel: 'year' | 'quarter' | 'month' | 'week';
  storageLevel: 'week';
  mapping: {
    sqlExpression: string;  // How to aggregate weeks
  };
}
```

**Examples:**

| Edit Level | SQL Expression | Description |
|-----------|----------------|-------------|
| `year` | `year` | Group weeks by year |
| `quarter` | `toQuarter(toDate(year, 1, 1) + toIntervalWeek(week))` | Map weeks to Q1-Q4 |
| `month` | `toMonth(toDate(year, 1, 1) + toIntervalWeek(week))` | Map weeks to Jan-Dec |
| `week` | `week` | Direct match (no aggregation) |

**Scenario: Edit at Month Level**

- User edits: "Electronics, January 2024, Sls U = 50,000"
- Storage: Product-Week granularity
- Mapping: All weeks in January (weeks 1-4) receive distributed values

```sql
-- Identify which weeks belong to January
SELECT week
FROM kpi_data
WHERE toMonth(toDate(year, 1, 1) + toIntervalWeek(week)) = 1
  AND year = 2024
-- Returns: [1, 2, 3, 4]
```

### Hierarchy Aggregation

**Mapping Edit Level to Storage Level:**

```typescript
interface HierarchyAggregation {
  editLevel: string[];      // e.g., ['dept', 'channel']
  storageLevel: string[];   // e.g., ['product_id', 'hierarchy_code', 'dept', 'channel']
  rollupPath?: string[];    // e.g., ['product_id', 'category', 'sub_dept', 'dept']
}
```

**Example Hierarchy:**

```
Department (dept)
  └── Sub-Department (sub_dept)
      └── Category (category)
          └── Product (product_id)
```

**Scenario 1: Edit at Department Level**

- User edits: "Electronics, 2024, Sls U = 500,000"
- Distribution: Across all products in Electronics dept

```typescript
{
  editLevel: ['dept'],
  storageLevel: ['product_id', 'hierarchy_code', 'dept'],
  rollupPath: ['product_id', 'category', 'sub_dept', 'dept']
}
```

**Scenario 2: Edit at Sub-Department Level**

- User edits: "Electronics → Televisions, Q1 2024, Sls U = 120,000"
- Distribution: Across all TV products

```typescript
{
  editLevel: ['dept', 'sub_dept'],
  storageLevel: ['product_id', 'hierarchy_code', 'dept', 'sub_dept', 'category'],
  rollupPath: ['product_id', 'category', 'sub_dept', 'dept']
}
```

### Complete Example: Department + Month Edit

**User Action:**
Edit "Electronics Dept, January 2024, Sls U = 50,000"

**Current State:**

| Product | Week | Current Sls U |
|---------|------|---------------|
| P001 | 1 | 100 |
| P001 | 2 | 150 |
| P002 | 1 | 200 |
| P002 | 2 | 250 |
| P003 | 1 | 300 |
| P003 | 2 | 350 |
| ... | ... | ... |
| **Total** | | **48,000** |

**Allocation Config:**

```typescript
const config: AllocationConfig = {
  strategy: 'pro_rata',

  aggregation: {
    time: {
      editLevel: 'month',
      storageLevel: 'week',
      mapping: { sqlExpression: 'toMonth(toDate(year, 1, 1) + toIntervalWeek(week))' }
    },
    hierarchy: {
      editLevel: ['dept'],
      storageLevel: ['product_id', 'hierarchy_code', 'dept', 'channel']
    },
    where: "dept = 'Electronics' AND toMonth(toDate(year, 1, 1) + toIntervalWeek(week)) = 1 AND year = 2024"
  },

  distribution: {
    granularity: ['product_id', 'week', 'year']
  }
};
```

**Workflow Execution:**

**Step 1: Calculate Current Aggregate**
```sql
SELECT SUM(sls_u) as current_value
FROM kpi_data
WHERE dept = 'Electronics'
  AND toMonth(toDate(year, 1, 1) + toIntervalWeek(week)) = 1
  AND year = 2024
-- Result: 48,000
```

**Step 2: Calculate Pro-Rata Weights**
```sql
WITH granular AS (
  SELECT product_id, week, sls_u
  FROM kpi_data
  WHERE dept = 'Electronics' AND month = 1 AND year = 2024
)
SELECT
  product_id,
  week,
  sls_u / 48000.0 as weight
FROM granular
```

| Product | Week | Current | Weight |
|---------|------|---------|--------|
| P001 | 1 | 100 | 0.00208 (100/48000) |
| P001 | 2 | 150 | 0.00312 (150/48000) |
| P002 | 1 | 200 | 0.00417 (200/48000) |
| P002 | 2 | 250 | 0.00521 (250/48000) |
| ... | ... | ... | ... |

**Step 3: Calculate Deltas**
```sql
SELECT
  product_id,
  week,
  (50000 - 48000) * weight as delta
FROM weights
```

| Product | Week | Delta |
|---------|------|-------|
| P001 | 1 | 2000 * 0.00208 = 4.16 |
| P001 | 2 | 2000 * 0.00312 = 6.24 |
| P002 | 1 | 2000 * 0.00417 = 8.34 |
| P002 | 2 | 2000 * 0.00521 = 10.42 |
| ... | ... | ... |

**Step 4: Apply Edits**
```sql
ALTER TABLE kpi_data
UPDATE sls_u = sls_u + delta
WHERE (product_id, week, year) IN (SELECT product_id, week, year FROM deltas)
```

| Product | Week | Old | New |
|---------|------|-----|-----|
| P001 | 1 | 100 | 104.16 |
| P001 | 2 | 150 | 156.24 |
| P002 | 1 | 200 | 208.34 |
| P002 | 2 | 250 | 260.42 |
| ... | ... | ... | ... |
| **Total** | | **48,000** | **50,000** ✓ |

**Step 5+: Rebalance Dependent KPIs**

Execute topological sort levels:
- Level 0: GM $, WOS (depend on Sls U)
- Level 1: GM% (depends on GM $)
- etc.

### Usage

**Generate Single-Product Edit Workflow:**
```typescript
import { generateSingleProductEditWorkflow } from './workflows/workflowGenerator';

const workflow = generateSingleProductEditWorkflow({
  editedKPI: 'Sls U',
  editedValue: 150,
  productId: 'P001',
  week: 14,
  year: 2024
});

// Execute workflow via external framework
executeWorkflow(workflow);
```

**Generate Aggregated Edit Workflow:**
```typescript
import { generateAggregatedEditWorkflow } from './workflows/workflowGenerator';

const workflow = generateAggregatedEditWorkflow({
  editedKPI: 'Sls U',
  editedValue: 50000,
  allocationConfig: {
    strategy: 'pro_rata',
    aggregation: {
      time: { editLevel: 'month', storageLevel: 'week', mapping: { sqlExpression: 'toMonth(...)' } },
      hierarchy: { editLevel: ['dept'], storageLevel: ['product_id', 'dept'] },
      where: "dept = 'Electronics' AND month = 1 AND year = 2024"
    },
    distribution: { granularity: ['product_id', 'week', 'year'] }
  }
});

executeWorkflow(workflow);
```

**See Full Examples:**
- `/workflows/examples.ts` - 7 complete examples with different strategies
- Examples include: year/month/quarter edits, pro-rata/equal/historical/weighted/custom strategies

---

## Summary

**Key Architectural Points:**

1. **Unified Dependency Graph**: Formula and custom handler KPIs coexist in same graph
2. **Topological Sort**: Kahn's algorithm ensures correct execution order
3. **Two Execution Paths**: Formulas use mathjs, custom handlers use JavaScript functions
4. **Full Data Access**: Custom handlers can access all weeks, all KPIs
5. **Execution Logging**: Captures inputs, intermediate steps, outputs for audit
6. **SQL Generation**: Two modes - POC (explanation) and Production (executable)
7. **Multi-Week Effects**: Special handling for EOP→BOP and Return Inv delays
8. **Lock Strategy**: Prevents circular dependencies during edits

**Extension Points:**

- Add formula KPI: Config + type + mapping + initial data
- Add custom handler: Config + type + handler function + (optional) production SQL
- Add intermediate steps: Logic in custom handler that doesn't return KPI value
- Add production SQL: Translate JavaScript logic to ClickHouse CTEs/window functions

**Execution Guarantees:**

- Dependencies always resolve before dependents
- KPIs in same level can execute in parallel
- Locked KPIs never recalculate
- Multi-week effects apply after all single-week calculations
- All changes logged with before/after values
