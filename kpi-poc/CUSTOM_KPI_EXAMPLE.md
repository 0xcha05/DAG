# Custom KPI Example: Complete Walkthrough

This document shows a **real example** of how custom KPIs work in both execution modes.

---

## Scenario

**Product:** PROD-001 (Winter Jacket)
**Week 10 Data:**
- Sls U = 1000 units
- Sls $ = $10,000
- AUR = $10.00
- AUC = $6.00
- EOP U = 440 units
- Smart Reorder Point = 280 units (calculated)

**User Action:** Edit Sls U from 1000 → 1200

---

## In-Memory Mode: Step-by-Step

### Step 1: User Edits Value

```
Cell: Week 10, Sls U
Old Value: 1000
New Value: 1200  ← User types this
```

### Step 2: Engine Processes Edit

```javascript
// KPIEngine.rebalance() is called
rebalance(productData, weekNumber: 10, editedKPI: 'Sls U', newValue: 1200)

// Log the user edit
logs.push({
  type: 'user-edit',
  kpi: 'Sls U',
  oldValue: 1000,
  newValue: 1200,
  week: 10
})

// Apply the edit
currentValues['Sls U'] = 1200
```

### Step 3: Calculate Dependent KPIs (Topological Order)

**Level 0: Direct Formula KPIs**

```javascript
// Sls $ (formula: Sls U * AUR)
evaluateFormula('Sls U * AUR', currentValues)
// = 1200 * 10 = 12000
currentValues['Sls $'] = 12000

logs.push({
  type: 'system-recalc',
  kpi: 'Sls $',
  oldValue: 10000,
  newValue: 12000,
  triggeredBy: 'Sls U',
  calculationLevel: 1,
  formula: 'Sls U * AUR'
})

// COGS (formula: Sls U * AUC)
evaluateFormula('Sls U * AUC', currentValues)
// = 1200 * 6 = 7200
currentValues['COGS'] = 7200

logs.push({
  type: 'system-recalc',
  kpi: 'COGS',
  oldValue: 6000,
  newValue: 7200,
  triggeredBy: 'Sls U',
  calculationLevel: 1,
  formula: 'Sls U * AUC'
})
```

**Level 1: GM $ (depends on Sls $ and COGS)**

```javascript
// GM $ (formula: Sls $ - COGS)
evaluateFormula('Sls $ - COGS', currentValues)
// = 12000 - 7200 = 4800
currentValues['GM $'] = 4800

logs.push({
  type: 'system-recalc',
  kpi: 'GM $',
  oldValue: 4000,
  newValue: 4800,
  triggeredBy: 'Sls U',
  calculationLevel: 2,
  formula: 'Sls $ - COGS'
})
```

**Level 2: Smart Reorder Point (CUSTOM HANDLER)**

```javascript
// Check if custom handler exists
hasCustomHandler('Smart Reorder Point')  // returns TRUE

// Execute custom handler instead of formula
executeCustomHandler('Smart Reorder Point', productData, 10, currentValues)

// Inside custom handler:
function smartReorderPointHandler(productData, week) {
  // Step 1: Gather sales history (last 4 weeks)
  const week6 = productData.weeks.get(6).values['Sls U']  // 950
  const week7 = productData.weeks.get(7).values['Sls U']  // 1100
  const week8 = productData.weeks.get(8).values['Sls U']  // 1050
  const week9 = productData.weeks.get(9).values['Sls U']  // 1200
  const salesHistory = [950, 1100, 1050, 1200]

  // Step 2: Calculate average demand
  const avgDemand = (950 + 1100 + 1050 + 1200) / 4 = 1075

  // Step 3: Calculate standard deviation
  const variance = (
    Math.pow(950 - 1075, 2) +
    Math.pow(1100 - 1075, 2) +
    Math.pow(1050 - 1075, 2) +
    Math.pow(1200 - 1075, 2)
  ) / 4
  // = (15625 + 625 + 625 + 15625) / 4 = 8125
  const stdDev = Math.sqrt(8125) = 90.14

  // Step 4: Lead time demand (2 weeks)
  const leadTimeDemand = 1075 * 2 = 2150

  // Step 5: Safety stock (95% service level, Z = 1.645)
  const safetyStock = 1.645 * 90.14 * Math.sqrt(2)
  // = 1.645 * 90.14 * 1.414 = 209.7

  // Step 6: Seasonal adjustment (compare to 8 weeks ago)
  const week2Sales = productData.weeks.get(2).values['Sls U']  // 1020
  const seasonalFactor = 1020 / 1075 = 0.949
  // Clamped: Math.max(0.8, Math.min(1.5, 0.949)) = 0.949

  // Step 7: Final reorder point
  const reorderPoint = 2150 * 0.949 + 209.7
  // = 2040.4 + 209.7 = 2250.1
  return Math.round(2250.1) = 2250
}

// Result
currentValues['Smart Reorder Point'] = 2250

logs.push({
  type: 'system-recalc',
  kpi: 'Smart Reorder Point',
  oldValue: 280,
  newValue: 2250,
  triggeredBy: 'Sls U',
  calculationLevel: 3,
  formula: '[Custom Handler: Smart Reorder Point]'  ← Special marker
})
```

### Step 4: Update UI

```
Grid Updates (yellow highlights):
┌──────┬─────────┬─────────┬─────────┬──────────┬─────────────────────┐
│ Week │  Sls U  │  Sls $  │  COGS   │   GM $   │ Smart Reorder Point │
├──────┼─────────┼─────────┼─────────┼──────────┼─────────────────────┤
│  10  │ [1200]  │ [12000] │ [7200]  │ [4800]   │ [2250]              │
│      │  +200   │ +2000   │ +1200   │  +800    │ +1970               │
└──────┴─────────┴─────────┴─────────┴──────────┴─────────────────────┘
     Yellow highlights fade after 3 seconds

Logs Panel:
┌─────────────────────────────────────────────────────────────────────┐
│ Change History (Week 10)                                            │
├─────────────────────────────────────────────────────────────────────┤
│ [user-edit] Sls U: 1000 → 1200                                      │
│ [system-recalc] Sls $: 10000 → 12000 (Level 1, Sls U * AUR)        │
│ [system-recalc] COGS: 6000 → 7200 (Level 1, Sls U * AUC)           │
│ [system-recalc] GM $: 4000 → 4800 (Level 2, Sls $ - COGS)          │
│ [system-recalc] Smart Reorder Point: 280 → 2250                    │
│                 (Level 3, [Custom Handler: Smart Reorder Point])   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## ClickHouse Mode: Step-by-Step

### Step 1: User Edits Value (Same as Above)

```
Cell: Week 10, Sls U
Old Value: 1000
New Value: 1200  ← User types this
```

### Step 2: Engine Calculates Changes (In-Memory)

Same calculation happens, but **data is not persisted**. Instead, the results are used to generate SQL queries.

### Step 3: Generate SQL Queries

```javascript
// Call query generation service
const queries = generateRebalancingQueries(
  'PROD-001',  // productId
  2024,        // year
  result,      // rebalancing result from engine
  'Sls U',     // edited KPI
  10,          // week
  1200         // new value
)
```

**Generated Queries (11 total):**

#### Query 1: Log User Edit

```sql
-- Log user edit: Sls U (1000.00 → 1200.00)
INSERT INTO kpi_audit_log (
  id, timestamp, log_type, product_id, week, year,
  kpi_name, old_value, new_value, user_id
) VALUES (
  generateUUIDv4(),
  now(),
  'user-edit',
  {productId:String},
  {week:UInt8},
  {year:UInt16},
  {kpiName:String},
  {oldValue:Float64},
  {newValue:Float64},
  NULL
)

Parameters:
  productId = 'PROD-001'
  week = 10
  year = 2024
  kpiName = 'Sls U'
  oldValue = 1000
  newValue = 1200
```

#### Query 2: Update Sls U

```sql
-- Update Sls U to 1200.00 (Week 10)
ALTER TABLE kpi_data
UPDATE
  sls_u = {newValue:Float64},
  last_edited_kpi = {kpiName:String},
  last_edited_timestamp = now(),
  updated_at = now()
WHERE product_id = {productId:String}
  AND week = {week:UInt8}

Parameters:
  productId = 'PROD-001'
  week = 10
  kpiName = 'Sls U'
  newValue = 1200
```

#### Query 3: Log Sls $ Recalculation

```sql
-- Log system recalc: Sls $ (Level 1, triggered by Sls U)
INSERT INTO kpi_audit_log (
  id, timestamp, log_type, product_id, week, year,
  kpi_name, old_value, new_value,
  triggered_by, calculation_level, formula
) VALUES (
  generateUUIDv4(),
  now(),
  'system-recalc',
  {productId:String},
  {week:UInt8},
  {year:UInt16},
  {kpiName:String},
  {oldValue:Float64},
  {newValue:Float64},
  {triggeredBy:String},
  {calculationLevel:UInt8},
  {formula:String}
)

Parameters:
  productId = 'PROD-001'
  week = 10
  year = 2024
  kpiName = 'Sls $'
  oldValue = 10000
  newValue = 12000
  triggeredBy = 'Sls U'
  calculationLevel = 1
  formula = 'Sls U * AUR'
```

#### Query 4: Update Sls $

```sql
-- Update Sls $ to 12000.00 (Week 10)
ALTER TABLE kpi_data
UPDATE
  sls_dollars = {newValue:Float64},
  last_edited_kpi = {kpiName:String},
  last_edited_timestamp = now(),
  updated_at = now()
WHERE product_id = {productId:String}
  AND week = {week:UInt8}

Parameters:
  productId = 'PROD-001'
  week = 10
  kpiName = 'Sls $'
  newValue = 12000
```

#### Queries 5-8: COGS and GM $ (Similar Pattern)

*Omitted for brevity - same structure as Sls $*

#### Query 9: Log Smart Reorder Point Recalculation [CUSTOM HANDLER]

```sql
-- Log system recalc: Smart Reorder Point (Level 3, triggered by Sls U) [CUSTOM HANDLER]
INSERT INTO kpi_audit_log (
  id, timestamp, log_type, product_id, week, year,
  kpi_name, old_value, new_value,
  triggered_by, calculation_level, formula
) VALUES (
  generateUUIDv4(),
  now(),
  'system-recalc',
  {productId:String},
  {week:UInt8},
  {year:UInt16},
  {kpiName:String},
  {oldValue:Float64},
  {newValue:Float64},
  {triggeredBy:String},
  {calculationLevel:UInt8},
  {formula:String}
)

Parameters:
  productId = 'PROD-001'
  week = 10
  year = 2024
  kpiName = 'Smart Reorder Point'
  oldValue = 280
  newValue = 2250
  triggeredBy = 'Sls U'
  calculationLevel = 3
  formula = '[Custom Handler: Smart Reorder Point]'  ← Notice the special formula
```

#### Query 10: Custom Handler Explanation (SPECIAL!)

```sql
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

Parameters:
  productId = 'PROD-001'
  week = 10
  kpiName = 'Smart Reorder Point'
```

#### Query 11: Update Smart Reorder Point

```sql
-- Update Smart Reorder Point to 2250.00 (Week 10)
ALTER TABLE kpi_data
UPDATE
  smart_reorder_point = {newValue:Float64},
  last_edited_kpi = {kpiName:String},
  last_edited_timestamp = now(),
  updated_at = now()
WHERE product_id = {productId:String}
  AND week = {week:UInt8}

Parameters:
  productId = 'PROD-001'
  week = 10
  kpiName = 'Smart Reorder Point'
  newValue = 2250
```

### Step 4: Display Query Modal

```
┌───────────────────────────────────────────────────────────────┐
│ Generated ClickHouse Queries                              [X] │
│ 11 queries generated (not executed)                           │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│ Query 1 of 11                                                │
│ Log user edit: Sls U (1000.00 → 1200.00)                     │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ INSERT INTO kpi_audit_log (...)                         │ │
│ │ VALUES (generateUUIDv4(), now(), 'user-edit', ...)      │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                               │
│ Parameters:                                                   │
│ productId = 'PROD-001'                                        │
│ week = 10                                                     │
│ kpiName = 'Sls U'                                             │
│ oldValue = 1000                                               │
│ newValue = 1200                                               │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│ Query 10 of 11  ← CUSTOM HANDLER EXPLANATION                │
│ Custom Handler Explanation: Smart Reorder Point              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ -- CUSTOM HANDLER EXPLANATION: Smart Reorder Point      │ │
│ │ -- This KPI cannot be calculated with a simple formula  │ │
│ │ -- Statistical reorder point calculation...             │ │
│ │ --                                                       │ │
│ │ -- Implementation requires COMPLEX LOGIC:               │ │
│ │ -- Step 1: Gather 4-week sales history                  │ │
│ │ -- Step 2: Calculate average demand                     │ │
│ │ -- Step 3: Calculate standard deviation                 │ │
│ │ -- Step 4: Calculate lead time demand                   │ │
│ │ -- Step 5: Calculate safety stock                       │ │
│ │ -- Step 6: Apply seasonal adjustment                    │ │
│ │ -- Step 7: Final reorder point = ...                    │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│ [Scroll for more queries...]                                 │
│                                                               │
│ These queries are generated but not executed.                │
│                                                 [Close]       │
└───────────────────────────────────────────────────────────────┘
```

---

## Key Differences

| Aspect | In-Memory Mode | ClickHouse Mode |
|--------|----------------|-----------------|
| **Calculation** | ✅ Executes immediately | ✅ Executes (for query generation) |
| **Data Update** | ✅ Updates productData | ❌ Data unchanged |
| **Custom Handler** | ✅ Runs full logic | ✅ Runs (to get value for SQL) |
| **Output** | Updated grid + logs | SQL queries in modal |
| **Custom KPI Handling** | Executes handler function | Handler + explanation comment |
| **Use Case** | Interactive testing | Preview SQL before DB integration |

---

## Why Custom Handlers Are Important

### Formula-Based KPI (Simple)

```typescript
// COGS = Sls U * AUC
// ✅ Can express as formula: "Sls U * AUC"
// ✅ Single line of math
// ✅ Only uses current week values

config: {
  name: 'COGS',
  formula: 'Sls U * AUC',
  dependsOn: ['Sls U', 'AUC']
}
```

### Custom Handler KPI (Complex)

```typescript
// Smart Reorder Point = statistical calculation
// ❌ Cannot express as simple formula
// ❌ Requires loops, historical data, square roots, conditions
// ❌ Needs 4-week lookback

config: {
  name: 'Smart Reorder Point',
  formula: undefined,  // No formula!
  dependsOn: ['Sls U']
}

handler: (productData, week) => {
  // 20+ lines of complex logic
  // Statistical calculations
  // Multi-week analysis
  return calculatedValue;
}
```

---

## Summary

**Custom KPI handlers enable:**
- ✅ Complex business logic that formulas can't express
- ✅ Historical data analysis (lookback/lookahead)
- ✅ Statistical calculations
- ✅ Seamless integration with formula-based KPIs
- ✅ Both execution modes supported

**In ClickHouse mode:**
- SQL explanation shows **what** the handler does
- Actual calculation happens in **application code**
- UPDATE query sets the **calculated value**
- Full transparency for architects/developers

**The system handles both types gracefully:**
1. Formula KPIs → Direct SQL calculation possible
2. Custom KPIs → Application-side calculation + SQL update
