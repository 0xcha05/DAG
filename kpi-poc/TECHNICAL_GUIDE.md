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
