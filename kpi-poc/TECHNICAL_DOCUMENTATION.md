# KPI Rebalancing Engine - Technical Documentation

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Business Problem](#business-problem)
3. [Solution Overview](#solution-overview)
4. [Core Concepts](#core-concepts)
5. [System Architecture](#system-architecture)
6. [Complex Components Explained](#complex-components-explained)
7. [Pseudocode Walkthrough](#pseudocode-walkthrough)
8. [Example Scenarios](#example-scenarios)

---

## Executive Summary

The KPI Rebalancing Engine is a proof-of-concept (POC) system that demonstrates automatic recalculation of interdependent retail/merchandising KPIs. When a user edits one metric (e.g., Sales Units), the system automatically recalculates all dependent metrics (e.g., COGS, Gross Margin, Return Inventory) while respecting business constraints and multi-week effects.

**Key Features:**
- Automatic dependency resolution using Directed Acyclic Graph (DAG)
- Smart lock strategies to maintain business constraints
- Multi-week propagation (EOP→BOP transitions, delayed returns)
- Visual feedback showing cascading changes
- Interactive dependency graph visualization
- Comprehensive logging of user edits vs. system recalculations

---

## Business Problem

### The Challenge

In retail merchandising planning, KPIs are highly interdependent:
- **Sales Units (Sls U)** determines how much product is sold
- **Cost of Goods Sold (COGS)** = Sls U × Unit Cost
- **Sales Dollars (Sls $)** = Sls U × Unit Retail Price
- **Gross Margin Dollars (GM $)** = Sls $ - COGS
- **Gross Margin % (GM %)** = GM $ / Sls $ × 100
- **Return Units (Return U)** affects inventory 4 weeks later
- **End of Period (EOP)** inventory becomes **Beginning of Period (BOP)** inventory next week

### Current Pain Points

1. **Manual Recalculation:** Analysts must manually update dozens of dependent cells when changing one value
2. **Error-Prone:** Easy to miss dependencies or make calculation mistakes
3. **Time-Consuming:** Updates can take hours for complex scenarios
4. **Lack of Transparency:** Difficult to understand what changed and why
5. **No Constraint Validation:** Easy to violate business rules (e.g., GM% must stay fixed)

### The Solution Goal

Build a system that:
- Automatically recalculates all dependent KPIs when one value changes
- Respects business constraints through "lock strategies"
- Handles multi-week effects (inventory transitions, delayed returns)
- Provides clear visual feedback on what changed
- Logs all changes for auditability

---

## Solution Overview

### High-Level Architecture

```
┌─────────────────┐
│  User Interface │
│   (React Grid)  │
└────────┬────────┘
         │ User edits "Sls U" in Week 1
         ▼
┌─────────────────────────────────────┐
│      KPI Rebalancing Engine         │
│                                     │
│  1. Detect edited KPI               │
│  2. Build dependency graph (DAG)    │
│  3. Sort KPIs by calculation order  │
│  4. Apply lock strategy             │
│  5. Recalculate dependent KPIs      │
│  6. Handle multi-week effects       │
│  7. Return updated values + logs    │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│  Updated Grid   │
│ Highlighted     │
│ Changes         │
└─────────────────┘
```

### Data Flow Example

**User Action:** Edit "Sls U" from 1000 → 1200 in Week 1

**System Response:**
1. Recalculate COGS (depends on Sls U)
2. Recalculate GM $ (depends on Sls $ and COGS)
3. Recalculate GM % (depends on GM $ and Sls $)
4. Recalculate EOP Units (depends on BOP, Receipts, Sls U, Return U)
5. Update BOP for Week 2 (EOP Week 1 becomes BOP Week 2)
6. Highlight all changed cells
7. Log each change with "user edit" vs "system recalc" labels

---

## Core Concepts

### 1. Directed Acyclic Graph (DAG)

A DAG represents KPI dependencies as a directed graph where:
- **Nodes** = KPIs (Sls U, COGS, GM $, etc.)
- **Edges** = Dependencies (arrow from A to B means "B depends on A")
- **Acyclic** = No circular dependencies (prevents infinite loops)

**Example DAG:**
```
   Sls U ────┐
   Unit Cost ┼──→ COGS ──┐
             │            │
   Unit Retail Price ─────┼──→ GM $ ──→ GM %
             │            │       │
             └──→ Sls $ ──┘       │
                                  │
                                  ▼
                              (and so on...)
```

**Why DAG?**
- Ensures we calculate KPIs in the correct order
- Prevents circular dependencies
- Allows automatic dependency discovery from formulas

### 2. Topological Sort (Kahn's Algorithm)

Topological sort determines the **order** in which to calculate KPIs.

**Problem:** If KPI B depends on KPI A, we must calculate A before B.

**Solution:** Kahn's algorithm finds a valid ordering:

**Example:**
```
Dependencies:
- COGS depends on: Sls U, Unit Cost
- GM $ depends on: Sls $, COGS
- GM % depends on: GM $, Sls $

Topological Order:
Level 1: Sls U, Unit Cost, Unit Retail Price
Level 2: COGS, Sls $
Level 3: GM $
Level 4: GM %
```

**Key Insight:** We process level by level. All KPIs in Level 1 are calculated first, then Level 2, etc.

### 3. Lock Strategies

Lock strategies define which KPIs should **not** be recalculated to maintain business constraints.

**Example Scenario:**
User wants to increase Sales Units but keep Discount Rate (DR%) and Return Rate (Return %) fixed.

**Without Lock Strategy:**
- Edit Sls U → System might recalculate DR% → Business constraint violated!

**With Lock Strategy:**
- Mark DR% and Return % as "locked"
- System skips recalculating these KPIs
- Business constraints maintained

**Implementation:**
```
Lock Strategy: When editing Sls U
  - Lock: DR%, Return %
  - Reason: Merchandiser wants to see impact of Sls U changes
            while holding promotional discount and return rates constant
```

### 4. Multi-Week Effects

Some KPIs affect future weeks:

**A. EOP → BOP Transition**
- End of Period inventory (Week N) becomes Beginning of Period inventory (Week N+1)
- Example: If Week 1 EOP = 500 units, then Week 2 BOP = 500 units

**B. Return Inventory (4-week delay)**
- Returns from Week N become Return Inventory in Week N+4
- 10% damage factor applied
- Example: Week 1 has 100 Return U → Week 5 gets 90 Return Inv (100 × 90%)

**C. Cross-Week Cascading**
- Changes in Week 1 can cascade through all subsequent weeks
- Example: Changing Week 1 EOP updates Week 2 BOP, which affects Week 2 EOP, which affects Week 3 BOP, etc.

### 5. Formula Evaluation

KPIs can be:
- **Editable:** User can directly change the value (e.g., Sls U, Unit Cost)
- **Calculated:** Value computed from formula (e.g., COGS = Sls U × Unit Cost)
- **Locked:** Temporarily prevented from recalculation due to lock strategy

**Formula Syntax:**
- Uses variable names in formulas: `"Sls U * Unit Cost"`
- Math operations: `+`, `-`, `*`, `/`, `^`
- Parentheses for order: `"(Sls $ - COGS) / Sls $ * 100"`

---

## System Architecture

### Component Breakdown

#### 1. **KPI Configuration** (Static Data)
Defines each KPI's properties:
```
{
  name: "COGS",
  formula: "Sls U * Unit Cost",
  isEditable: false,
  color: "#10b981"
}
```

#### 2. **Product Data** (Dynamic State)
Stores actual KPI values per week:
```
Week 1: {
  "Sls U": 1000,
  "Unit Cost": 10,
  "COGS": 10000,
  ...
}
```

#### 3. **Dependency Graph Builder**
Analyzes formulas to extract dependencies:
```
Formula: "Sls U * Unit Cost"
→ Dependencies: ["Sls U", "Unit Cost"]
→ DAG Edge: Sls U → COGS
→ DAG Edge: Unit Cost → COGS
```

#### 4. **Topological Sorter**
Orders KPIs for calculation using Kahn's algorithm.

#### 5. **Rebalancing Engine**
Core calculation engine that:
- Accepts: edited KPI, new value, week number
- Returns: updated values for all affected KPIs + change logs

#### 6. **Lock Strategy Resolver**
Determines which KPIs to lock based on edited KPI.

#### 7. **Multi-Week Effect Handler**
Propagates changes across weeks (EOP→BOP, Return Inv).

#### 8. **UI Components**
- **KPI Grid:** Interactive spreadsheet-like grid
- **DAG Visualization:** Visual graph showing dependencies
- **Config Editor:** Edit KPI formulas and properties
- **Logs Panel:** View edit history with cascading changes

---

## Complex Components Explained

### Component 1: Dependency Graph Builder

**Purpose:** Automatically discover which KPIs depend on which others by parsing formulas.

**Challenge:** Extract variable names from formula strings like `"(Sls $ - COGS) / Sls $ * 100"`.

**Approach:**
1. Parse formula into tokens (numbers, operators, variables)
2. Identify variable names (tokens that match KPI names)
3. Build adjacency list: `KPI A → [KPI B, KPI C]` means B and C depend on A

**Example:**
```
Input Formula: "Sls U * Unit Cost"
Tokens: ["Sls U", "*", "Unit Cost"]
Variables Found: ["Sls U", "Unit Cost"]
Result: COGS depends on [Sls U, Unit Cost]
```

### Component 2: Topological Sort (Kahn's Algorithm)

**Purpose:** Find the order to calculate KPIs so all dependencies are satisfied.

**Challenge:** If we calculate GM $ before COGS, we'll use stale COGS value!

**Kahn's Algorithm Steps:**
1. Count incoming edges for each node (in-degree)
2. Start with nodes that have in-degree = 0 (no dependencies)
3. Process these nodes, remove their outgoing edges
4. Repeat until all nodes processed

**Detailed Example:**

**Dependency Graph:**
```
Sls U ──→ COGS ──→ GM $
Unit Cost ─┘
```

**In-Degrees:**
- Sls U: 0 (no dependencies)
- Unit Cost: 0 (no dependencies)
- COGS: 2 (depends on Sls U, Unit Cost)
- GM $: 1 (depends on COGS)

**Processing:**
```
Step 1: Queue = [Sls U, Unit Cost] (in-degree 0)
Step 2: Process Sls U
  - Reduce COGS in-degree: 2 → 1
Step 3: Process Unit Cost
  - Reduce COGS in-degree: 1 → 0
  - Add COGS to queue
Step 4: Process COGS
  - Reduce GM $ in-degree: 1 → 0
  - Add GM $ to queue
Step 5: Process GM $

Result: [Sls U, Unit Cost, COGS, GM $]
```

**Grouped by Levels:**
```
Level 0: [Sls U, Unit Cost]
Level 1: [COGS]
Level 2: [GM $]
```

### Component 3: Lock Strategy System

**Purpose:** Prevent certain KPIs from being recalculated to maintain business constraints.

**Example Scenario:**
User edits "Sls U" and wants to see impact on revenue while keeping discount rate fixed.

**Lock Strategy Definition:**
```
If editing "Sls U":
  Lock: ["DR%", "Return %"]
  Reason: Keep promotional rates constant
```

**Implementation:**
```
When editing Sls U:
1. Look up lock strategy for "Sls U"
2. Get locked KPIs: ["DR%", "Return %"]
3. During recalculation, skip locked KPIs
4. Even if DR% formula is triggered, don't update it
```

**Result:**
- DR% and Return % values remain unchanged
- All other dependent KPIs recalculate normally

### Component 4: Multi-Week Effect Handler

**Purpose:** Propagate changes across weeks for time-dependent relationships.

**Effect 1: EOP → BOP Transition**

**Business Logic:**
- Inventory at end of Week N = Inventory at beginning of Week N+1
- Formula: `BOP(week N+1) = EOP(week N)`

**Implementation Flow:**
```
Week 1 Edit: Sls U changes
→ Recalculate Week 1 EOP U
→ Week 1 EOP U changed from 500 → 600
→ Set Week 2 BOP U = 600
→ Recalculate Week 2 EOP U (because BOP U changed)
→ Week 2 EOP U changed from 450 → 550
→ Set Week 3 BOP U = 550
→ Continue cascading through all weeks...
```

**Effect 2: Return Inventory (4-week delay)**

**Business Logic:**
- Returns in Week N become damaged inventory in Week N+4
- 90% of returns are salvageable (10% damaged)
- Formula: `Return Inv(week N+4) = Return U(week N) × 0.9`

**Implementation Flow:**
```
Week 1 Edit: Return U changes from 50 → 80
→ Calculate Return Inv for Week 5 (1 + 4)
→ Return Inv Week 5 = 80 × 0.9 = 72
→ Recalculate Week 5 EOP (because Return Inv changed)
→ Week 5 EOP affects Week 6 BOP
→ Cascade continues...
```

### Component 5: Change Tracking & Logging

**Purpose:** Track what changed and why for auditability and user feedback.

**Log Types:**
1. **User Edit:** Direct user action
2. **System Recalculation:** Automatic recalculation due to dependency

**Log Entry Structure:**
```
{
  timestamp: "2025-11-14 10:23:45",
  type: "user-edit",
  kpi: "Sls U",
  oldValue: 1000,
  newValue: 1200,
  week: 1
}

{
  timestamp: "2025-11-14 10:23:45",
  type: "system-recalc",
  kpi: "COGS",
  oldValue: 10000,
  newValue: 12000,
  week: 1,
  triggeredBy: "Sls U",
  calculationLevel: 2,
  formula: "Sls U * Unit Cost"
}
```

**Grouping:**
- Logs are grouped by the triggering user edit
- Each group shows the cascade of system recalculations
- Calculation levels show dependency depth

---

## Pseudocode Walkthrough

### High-Level Flow

```
FUNCTION handleUserEdit(kpi, newValue, week):
  // 1. Initialize
  logs = []
  changes = []

  // 2. Log user edit
  oldValue = getData(week, kpi)
  logs.add({type: "user-edit", kpi, oldValue, newValue, week})

  // 3. Update the edited value
  setData(week, kpi, newValue)
  changes.add({kpi, value: newValue, week})

  // 4. Determine lock strategy
  lockedKPIs = getLockStrategy(kpi)

  // 5. Build dependency graph
  dependencies = buildDependencyGraph()

  // 6. Topological sort to get calculation order
  calculationLevels = topologicalSort(dependencies)

  // 7. Recalculate each level
  FOR EACH level IN calculationLevels:
    FOR EACH dependentKPI IN level:
      IF dependentKPI NOT IN lockedKPIs:
        oldValue = getData(week, dependentKPI)
        newValue = evaluateFormula(dependentKPI, week)

        IF newValue != oldValue:
          setData(week, dependentKPI, newValue)
          changes.add({kpi: dependentKPI, value: newValue, week})
          logs.add({
            type: "system-recalc",
            kpi: dependentKPI,
            oldValue,
            newValue,
            week,
            triggeredBy: kpi,
            calculationLevel: level.index
          })

  // 8. Handle multi-week effects
  multiWeekChanges = handleMultiWeekEffects(changes, week)
  changes.addAll(multiWeekChanges)

  // 9. Return results
  RETURN {updatedData, changes, logs}
```

### Detailed: Build Dependency Graph

```
FUNCTION buildDependencyGraph():
  graph = new Map()  // KPI → [dependent KPIs]
  reverseGraph = new Map()  // KPI → [KPIs it depends on]

  FOR EACH kpiConfig IN kpiConfigurations:
    IF kpiConfig.formula EXISTS:
      // Parse formula to extract dependencies
      dependencies = extractVariables(kpiConfig.formula)

      FOR EACH dependency IN dependencies:
        // Add edge: dependency → kpiConfig.name
        IF graph[dependency] NOT EXISTS:
          graph[dependency] = []
        graph[dependency].add(kpiConfig.name)

        // Add reverse edge for topological sort
        IF reverseGraph[kpiConfig.name] NOT EXISTS:
          reverseGraph[kpiConfig.name] = []
        reverseGraph[kpiConfig.name].add(dependency)

  RETURN {graph, reverseGraph}

FUNCTION extractVariables(formula):
  // Example: "(Sls $ - COGS) / Sls $ * 100"
  // Tokenize by operators and parentheses
  tokens = tokenize(formula, ['+', '-', '*', '/', '(', ')', '^'])

  variables = []
  FOR EACH token IN tokens:
    // Skip if it's a number or operator
    IF token IS number OR token IS operator:
      CONTINUE

    // Check if token matches any KPI name
    IF token IN kpiNames:
      variables.add(token)

  RETURN unique(variables)
```

**Example Run:**
```
Formula: "Sls U * Unit Cost"

Step 1: Tokenize
  tokens = ["Sls U", "*", "Unit Cost"]

Step 2: Filter variables
  "Sls U" → is KPI name ✓
  "*" → is operator ✗
  "Unit Cost" → is KPI name ✓

Result: ["Sls U", "Unit Cost"]
```

### Detailed: Topological Sort (Kahn's Algorithm)

```
FUNCTION topologicalSort(dependencies):
  // Calculate in-degrees (number of incoming edges)
  inDegree = new Map()
  FOR EACH kpi IN allKPIs:
    inDegree[kpi] = 0

  FOR EACH kpi IN allKPIs:
    FOR EACH dependent IN dependencies[kpi]:
      inDegree[dependent]++

  // Initialize queue with nodes having in-degree 0
  queue = []
  FOR EACH kpi IN allKPIs:
    IF inDegree[kpi] == 0:
      queue.add(kpi)

  // Process nodes level by level
  levels = []
  currentLevel = 0

  WHILE queue NOT empty:
    currentLevelNodes = queue.removeAll()
    levels[currentLevel] = currentLevelNodes

    FOR EACH node IN currentLevelNodes:
      // For each outgoing edge
      FOR EACH dependent IN dependencies[node]:
        inDegree[dependent]--

        // If all dependencies satisfied, add to next level
        IF inDegree[dependent] == 0:
          queue.add(dependent)

    currentLevel++

  // Check for cycles
  IF sum(inDegree.values()) > 0:
    THROW "Circular dependency detected!"

  RETURN levels
```

**Example Run:**
```
Dependencies:
  Sls U → [COGS, Sls $]
  Unit Cost → [COGS]
  COGS → [GM $]
  Sls $ → [GM $, GM %]
  GM $ → [GM %]

Step 1: Calculate in-degrees
  Sls U: 0
  Unit Cost: 0
  COGS: 2 (from Sls U, Unit Cost)
  Sls $: 1 (from Sls U)
  GM $: 2 (from COGS, Sls $)
  GM %: 2 (from Sls $, GM $)

Step 2: Initial queue (in-degree 0)
  queue = [Sls U, Unit Cost]

Step 3: Process Level 0
  Process Sls U:
    - Reduce COGS in-degree: 2 → 1
    - Reduce Sls $ in-degree: 1 → 0 → add to queue
  Process Unit Cost:
    - Reduce COGS in-degree: 1 → 0 → add to queue

  Level 0 = [Sls U, Unit Cost]
  Next queue = [Sls $, COGS]

Step 4: Process Level 1
  Process Sls $:
    - Reduce GM $ in-degree: 2 → 1
    - Reduce GM % in-degree: 2 → 1
  Process COGS:
    - Reduce GM $ in-degree: 1 → 0 → add to queue

  Level 1 = [Sls $, COGS]
  Next queue = [GM $]

Step 5: Process Level 2
  Process GM $:
    - Reduce GM % in-degree: 1 → 0 → add to queue

  Level 2 = [GM $]
  Next queue = [GM %]

Step 6: Process Level 3
  Process GM %:
    (no outgoing edges)

  Level 3 = [GM %]

Result:
  Level 0: [Sls U, Unit Cost]
  Level 1: [Sls $, COGS]
  Level 2: [GM $]
  Level 3: [GM %]
```

### Detailed: Lock Strategy Resolution

```
FUNCTION getLockStrategy(editedKPI):
  // Define lock strategies for each editable KPI
  lockStrategies = {
    "Sls U": ["DR%", "Return %"],
    "Unit Cost": [],
    "Unit Retail Price": [],
    "Receipts": [],
    "Return U": []
  }

  RETURN lockStrategies[editedKPI] OR []

FUNCTION shouldSkipRecalculation(kpi, lockedKPIs):
  RETURN kpi IN lockedKPIs
```

**Example:**
```
User edits: Sls U

Step 1: Get lock strategy
  lockedKPIs = getLockStrategy("Sls U")
  lockedKPIs = ["DR%", "Return %"]

Step 2: During recalculation
  FOR EACH kpi IN calculationOrder:
    IF shouldSkipRecalculation(kpi, lockedKPIs):
      SKIP  // Don't recalculate this KPI
    ELSE:
      recalculate(kpi)

Result:
  ✓ COGS recalculated (not locked)
  ✓ GM $ recalculated (not locked)
  ✗ DR% NOT recalculated (locked)
  ✗ Return % NOT recalculated (locked)
```

### Detailed: Multi-Week Effects

```
FUNCTION handleMultiWeekEffects(changes, editedWeek):
  multiWeekChanges = []

  // Effect 1: EOP → BOP Transition
  FOR week FROM editedWeek TO maxWeek - 1:
    eopU_current = getData(week, "EOP U")
    eopDollars_current = getData(week, "EOP $")

    bopU_next = getData(week + 1, "BOP U")
    bopDollars_next = getData(week + 1, "BOP $")

    IF eopU_current != bopU_next:
      setData(week + 1, "BOP U", eopU_current)
      multiWeekChanges.add({
        kpi: "BOP U",
        week: week + 1,
        value: eopU_current,
        reason: "EOP from week " + week
      })

      // Recursively recalculate week + 1 because BOP changed
      weekChanges = recalculateWeek(week + 1, "BOP U")
      multiWeekChanges.addAll(weekChanges)

    // Same for EOP $ → BOP $
    IF eopDollars_current != bopDollars_next:
      setData(week + 1, "BOP $", eopDollars_current)
      multiWeekChanges.add({
        kpi: "BOP $",
        week: week + 1,
        value: eopDollars_current,
        reason: "EOP $ from week " + week
      })

      weekChanges = recalculateWeek(week + 1, "BOP $")
      multiWeekChanges.addAll(weekChanges)

  // Effect 2: Return Inventory (4-week delay)
  FOR EACH change IN changes:
    IF change.kpi == "Return U":
      targetWeek = change.week + 4

      IF targetWeek <= maxWeek:
        returnInv = change.value * 0.9  // 10% damage

        oldReturnInv = getData(targetWeek, "Return Inv")
        IF returnInv != oldReturnInv:
          setData(targetWeek, "Return Inv", returnInv)
          multiWeekChanges.add({
            kpi: "Return Inv",
            week: targetWeek,
            value: returnInv,
            reason: "Return U from week " + change.week
          })

          // Recalculate target week because Return Inv changed
          weekChanges = recalculateWeek(targetWeek, "Return Inv")
          multiWeekChanges.addAll(weekChanges)

  RETURN multiWeekChanges
```

**Example Run:**

**Scenario:** Edit Sls U in Week 1

```
Week 1 Initial State:
  BOP U: 1000
  Receipts: 500
  Sls U: 1000 → 1200 (user edit)
  Return U: 50
  EOP U: 1000 + 500 - 1000 - 50 = 450

Week 1 After Recalculation:
  EOP U: 1000 + 500 - 1200 - 50 = 250

Step 1: Check EOP → BOP transition
  Week 1 EOP U changed: 450 → 250
  Set Week 2 BOP U = 250

Step 2: Recalculate Week 2
  Week 2 BOP U: 500 → 250
  Week 2 EOP U recalculated:
    OLD: 500 + 300 - 600 - 30 = 170
    NEW: 250 + 300 - 600 - 30 = -80 (problem!)

Step 3: Check Week 2 → Week 3 transition
  Week 2 EOP U changed: 170 → -80
  Set Week 3 BOP U = -80

  ... continues cascading ...
```

### Detailed: Formula Evaluation

```
FUNCTION evaluateFormula(kpi, week):
  config = getKPIConfig(kpi)

  IF NOT config.formula:
    RETURN getData(week, kpi)  // No formula, return current value

  formula = config.formula

  // Replace variable names with actual values
  FOR EACH otherKPI IN allKPIs:
    value = getData(week, otherKPI)
    formula = formula.replace(otherKPI, value)

  // Evaluate mathematical expression
  result = evaluateMath(formula)

  RETURN result

FUNCTION evaluateMath(expression):
  // Use safe math parser (e.g., mathjs library)
  // Supports: +, -, *, /, ^, parentheses
  RETURN mathParser.evaluate(expression)
```

**Example:**
```
KPI: GM %
Formula: "(Sls $ - COGS) / Sls $ * 100"
Week: 1

Step 1: Get current values
  Sls $ = 25000
  COGS = 12000

Step 2: Replace variables
  formula = "(Sls $ - COGS) / Sls $ * 100"
  formula = "(25000 - 12000) / 25000 * 100"

Step 3: Evaluate
  = (13000) / 25000 * 100
  = 0.52 * 100
  = 52

Result: GM % = 52
```

---

## Example Scenarios

### Scenario 1: Edit Sales Units

**Initial State (Week 1):**
```
Sls U: 1000
Unit Cost: 10
Unit Retail Price: 25
COGS: 10,000
Sls $: 25,000
GM $: 15,000
GM %: 60
DR%: 20
```

**User Action:**
Edit Sls U: 1000 → 1200

**Lock Strategy:**
Lock DR% and Return % (keep promotional rates constant)

**Calculation Flow:**

```
Step 1: Update edited value
  Sls U = 1200

Step 2: Topological sort levels
  Level 1: [COGS, Sls $]
  Level 2: [GM $]
  Level 3: [GM %]

Step 3: Recalculate Level 1
  COGS = Sls U * Unit Cost
       = 1200 * 10
       = 12,000 (was 10,000)

  Sls $ = Sls U * Unit Retail Price
        = 1200 * 25
        = 30,000 (was 25,000)

Step 4: Recalculate Level 2
  GM $ = Sls $ - COGS
       = 30,000 - 12,000
       = 18,000 (was 15,000)

Step 5: Recalculate Level 3
  GM % = (GM $ / Sls $) * 100
       = (18,000 / 30,000) * 100
       = 60% (unchanged)

Step 6: Skip locked KPIs
  DR% = 20 (locked, not recalculated)
  Return % = (locked, not recalculated)
```

**Final State:**
```
Sls U: 1200 ✓ (user edit)
COGS: 12,000 ✓ (system recalc)
Sls $: 30,000 ✓ (system recalc)
GM $: 18,000 ✓ (system recalc)
GM %: 60 ✓ (system recalc)
DR%: 20 (locked)
```

**Logs:**
```
[User Edit] Sls U: 1000 → 1200 (Week 1)
  ├─ [Level 1] COGS: 10,000 → 12,000
  ├─ [Level 1] Sls $: 25,000 → 30,000
  ├─ [Level 2] GM $: 15,000 → 18,000
  └─ [Level 3] GM %: 60 → 60
```

### Scenario 2: Multi-Week EOP → BOP Cascade

**Initial State:**
```
Week 1:
  BOP U: 1000
  Receipts: 500
  Sls U: 1000
  Return U: 50
  EOP U: 450

Week 2:
  BOP U: 450  (= Week 1 EOP U)
  Receipts: 300
  Sls U: 600
  Return U: 30
  EOP U: 120

Week 3:
  BOP U: 120  (= Week 2 EOP U)
  ...
```

**User Action:**
Edit Week 1 Sls U: 1000 → 1200

**Calculation Flow:**

```
Step 1: Recalculate Week 1 EOP
  EOP U = BOP U + Receipts - Sls U - Return U
        = 1000 + 500 - 1200 - 50
        = 250 (was 450)

Step 2: Propagate to Week 2 BOP
  Week 2 BOP U = Week 1 EOP U
               = 250 (was 450)

Step 3: Recalculate Week 2 EOP
  EOP U = BOP U + Receipts - Sls U - Return U
        = 250 + 300 - 600 - 30
        = -80 (was 120)

  Note: Negative inventory indicates stockout!

Step 4: Propagate to Week 3 BOP
  Week 3 BOP U = Week 2 EOP U
               = -80 (was 120)

Step 5: Recalculate Week 3 EOP
  ... continues cascading ...
```

**Result:**
Single edit in Week 1 cascades through all subsequent weeks, updating BOP and EOP values.

### Scenario 3: Return Inventory 4-Week Delay

**Initial State:**
```
Week 1:
  Return U: 50

Week 5:
  Return Inv: 45  (= 50 * 0.9 from Week 1)
```

**User Action:**
Edit Week 1 Return U: 50 → 80

**Calculation Flow:**

```
Step 1: Update Week 1 Return U
  Return U = 80

Step 2: Recalculate Week 1 EOP
  (Return U affects EOP formula)

Step 3: Calculate Week 5 Return Inv
  Target week = 1 + 4 = 5
  Return Inv = Return U * 0.9
             = 80 * 0.9
             = 72 (was 45)

Step 4: Recalculate Week 5 EOP
  EOP U = BOP U + Receipts - Sls U - Return U + Return Inv
        = ... + 72 (was ... + 45)

Step 5: Propagate Week 5 EOP → Week 6 BOP
  (EOP changed, so cascade continues)
```

**Result:**
Returns in Week 1 affect inventory availability 4 weeks later, with proper damage factor applied.

---

## Visual Feedback System

### Grid Highlighting

**Purpose:** Show users what changed and why.

**Highlight Types:**

1. **Yellow Pulse:** KPIs that changed value
   - Fades after 2 seconds
   - Shows both user edits and system recalculations

2. **Blue Highlight (Hover):** The KPI currently being hovered
   - Shows user which KPI they're inspecting

3. **Orange Gradients (Hover):** Dependent KPIs at different levels
   - **Dark Orange:** Level 1 (directly depends on hovered KPI)
   - **Medium Orange:** Level 2 (2 steps away)
   - **Light Orange:** Level 3+ (3+ steps away)

**Example:**
```
User hovers over "Sls U"

Grid Display:
  Sls U: [BLUE] ← hovered KPI
  COGS: [DARK ORANGE] ← Level 1 dependent
  GM $: [MEDIUM ORANGE] ← Level 2 dependent
  GM %: [LIGHT ORANGE] ← Level 3 dependent
```

### DAG Visualization

**Purpose:** Show dependency relationships graphically.

**Interaction:**
- Click on a node to highlight its dependencies
- **Green nodes:** Parents (KPIs that the clicked node depends on)
- **Orange nodes:** Children (KPIs that depend on the clicked node)
- **Blue node:** The clicked node itself

**Example:**
```
User clicks "GM $" node

DAG Display:
  Sls $ → [GM $] → GM %
   ↓      [BLUE]   [ORANGE]
  COGS
 [GREEN]

Legend:
  Green (Sls $, COGS): Parents - GM $ depends on these
  Blue (GM $): Selected node
  Orange (GM %): Children - this depends on GM $
```

### Logs Panel

**Purpose:** Audit trail of all edits and recalculations.

**Features:**
- **Blue entries:** User edits (manual changes)
- **Green entries:** System recalculations (automatic)
- **Expandable groups:** Click to see cascade of changes from one edit
- **Calculation levels:** Shows dependency order (Level 1, Level 2, etc.)
- **Formulas displayed:** See exact formula used for each recalculation

**Example:**
```
Edit History

[Blue] User Edit - 10:23:45 AM
Week 1: Sls U changed from 1000 → 1200
▼ Click to expand (4 cascading changes)

  [Green] System Recalc - Level 1
  Week 1: COGS changed from 10,000 → 12,000
  Formula: Sls U * Unit Cost

  [Green] System Recalc - Level 1
  Week 1: Sls $ changed from 25,000 → 30,000
  Formula: Sls U * Unit Retail Price

  [Green] System Recalc - Level 2
  Week 1: GM $ changed from 15,000 → 18,000
  Formula: Sls $ - COGS

  [Green] System Recalc - Level 3
  Week 1: GM % changed from 60.0 → 60.0
  Formula: (Sls $ - COGS) / Sls $ * 100
```

---

## Performance Considerations

### Optimization Strategies

1. **Memoization:**
   - Cache dependency graph (only rebuild when configs change)
   - Cache topological sort result
   - Memoize affected KPIs during hover

2. **Incremental Updates:**
   - Only recalculate affected KPIs, not all KPIs
   - Use topological sort to skip independent branches

3. **Batching:**
   - Group multi-week changes into single state update
   - Reduce re-renders with React memoization

4. **Lazy Evaluation:**
   - Only compute hover highlights when actively hovering
   - Don't recalculate non-visible weeks

### Scalability

**Current POC Limits:**
- ~20 KPIs
- ~8 weeks
- ~160 cells total

**Production Considerations:**
- For 100+ KPIs, consider worker threads for calculation
- For 52+ weeks, implement virtualization for grid
- For complex formulas, consider compilation/caching

---

## Edge Cases & Error Handling

### Edge Case 1: Circular Dependencies

**Problem:**
```
KPI A formula: "B + 1"
KPI B formula: "A + 1"
→ A depends on B, B depends on A → Circular!
```

**Detection:**
Kahn's algorithm will detect this: if topological sort can't process all nodes, a cycle exists.

**Handling:**
```
IF sum(inDegrees) > 0 after topological sort:
  ERROR: "Circular dependency detected between KPIs"
  Show user which KPIs are involved in cycle
```

### Edge Case 2: Negative Inventory

**Problem:**
Recalculation results in EOP U = -50 (sold more than available)

**Handling:**
- Allow negative values (indicates stockout)
- Optionally: Add validation warnings in UI
- Optionally: Prevent edit that would cause negative inventory

### Edge Case 3: Division by Zero

**Problem:**
```
Formula: "GM $ / Sls $"
If Sls $ = 0 → division by zero!
```

**Handling:**
```
TRY:
  result = evaluateFormula(formula)
CATCH division by zero:
  result = 0  // or NaN, or show error
```

### Edge Case 4: Missing Dependencies

**Problem:**
Formula references KPI that doesn't exist.

**Handling:**
```
FUNCTION extractVariables(formula):
  variables = tokenize(formula)

  FOR EACH variable IN variables:
    IF variable NOT IN kpiNames:
      ERROR: "Unknown KPI '" + variable + "' in formula"
```

---

## Testing Strategies

### Unit Tests

1. **Dependency Graph Builder:**
   ```
   TEST: Extract variables from formula
     Input: "(Sls $ - COGS) / Sls $"
     Expected: ["Sls $", "COGS"]
   ```

2. **Topological Sort:**
   ```
   TEST: Sort simple DAG
     Input: A → B → C
     Expected: [[A], [B], [C]]

   TEST: Detect circular dependency
     Input: A → B → A
     Expected: Error thrown
   ```

3. **Formula Evaluation:**
   ```
   TEST: Evaluate arithmetic
     Formula: "10 * 5 + 3"
     Expected: 53
   ```

### Integration Tests

1. **Single Edit Cascade:**
   ```
   TEST: Edit Sls U updates dependent KPIs
     Action: Set Sls U = 1200
     Expected:
       - COGS recalculated
       - Sls $ recalculated
       - GM $ recalculated
       - GM % recalculated
   ```

2. **Multi-Week Propagation:**
   ```
   TEST: Week 1 EOP updates Week 2 BOP
     Action: Edit Week 1 Sls U
     Expected:
       - Week 1 EOP changes
       - Week 2 BOP = Week 1 EOP
       - Week 2 EOP recalculated
   ```

3. **Lock Strategy:**
   ```
   TEST: Locked KPIs not recalculated
     Action: Edit Sls U (locks DR%)
     Expected:
       - DR% value unchanged
       - Other KPIs recalculated normally
   ```

### User Acceptance Tests

1. **Visual Feedback:**
   - Verify yellow highlights appear for changed cells
   - Verify orange gradients show on hover
   - Verify DAG highlights on click

2. **Logs Accuracy:**
   - Verify user edits logged as "user-edit"
   - Verify system recalcs logged with correct trigger
   - Verify calculation levels are accurate

3. **Multi-Week Scenarios:**
   - Edit Week 1, verify Week 2-8 update correctly
   - Edit Return U, verify Return Inv appears 4 weeks later

---

## Future Enhancements

### Near-Term (v2)

1. **Undo/Redo:**
   - Implement history stack for edits
   - Allow reverting to previous states

2. **Bulk Edits:**
   - Edit multiple cells at once
   - Apply percentage changes across weeks

3. **Validation Rules:**
   - Prevent negative inventory
   - Warn on unusual GM% values
   - Flag constraint violations

### Mid-Term (v3)

1. **Scenario Comparison:**
   - Save multiple scenarios
   - Compare side-by-side
   - What-if analysis

2. **Custom Lock Strategies:**
   - User-defined lock rules
   - Conditional locks based on context

3. **Formula Builder UI:**
   - Visual formula editor
   - Autocomplete for KPI names
   - Syntax validation

### Long-Term (v4)

1. **AI-Powered Insights:**
   - Suggest optimal edits to hit targets
   - Detect anomalies in data
   - Recommend lock strategies

2. **Collaboration:**
   - Multi-user editing
   - Change tracking per user
   - Comment threads on cells

3. **Integration:**
   - Import from Excel/CSV
   - Export to planning systems
   - API for external tools

---

## Conclusion

The KPI Rebalancing Engine demonstrates a powerful approach to managing interdependent metrics in retail merchandising. By leveraging graph theory (DAG), algorithmic sorting (Kahn's), and reactive UI patterns, the system provides:

✓ **Automatic recalculation** of dependent KPIs
✓ **Business constraint enforcement** via lock strategies
✓ **Multi-week effect handling** for realistic inventory modeling
✓ **Visual feedback** showing cascading changes
✓ **Audit trail** distinguishing user edits from system recalculations

**Key Takeaways:**

1. **DAG + Topological Sort** ensures correct calculation order
2. **Lock strategies** maintain business rules during recalculation
3. **Multi-week effects** model real-world inventory transitions
4. **Visual feedback** improves user understanding and confidence
5. **Comprehensive logging** provides auditability and transparency

This POC provides a foundation for production merchandising planning tools that can save analysts hours of manual work while reducing errors and improving decision-making quality.

---

## Appendix: Complete KPI Configuration

```javascript
KPI Configurations:

1. Sales Units (Sls U)
   - Type: Editable
   - Formula: None
   - Lock Strategy: Lock DR%, Return %

2. Unit Cost
   - Type: Editable
   - Formula: None

3. Unit Retail Price
   - Type: Editable
   - Formula: None

4. Cost of Goods Sold (COGS)
   - Type: Calculated
   - Formula: "Sls U * Unit Cost"

5. Sales Dollars (Sls $)
   - Type: Calculated
   - Formula: "Sls U * Unit Retail Price"

6. Gross Margin $ (GM $)
   - Type: Calculated
   - Formula: "Sls $ - COGS"

7. Gross Margin % (GM %)
   - Type: Calculated
   - Formula: "(GM $ / Sls $) * 100"

8. Discount Rate % (DR%)
   - Type: Calculated
   - Formula: "(1 - (Sls $ / (Sls U * Unit Retail Price))) * 100"

9. Beginning of Period Units (BOP U)
   - Type: Special (set from previous week's EOP)
   - Formula: None

10. Receipts
    - Type: Editable
    - Formula: None

11. Return Units (Return U)
    - Type: Editable
    - Formula: None

12. End of Period Units (EOP U)
    - Type: Calculated
    - Formula: "BOP U + Receipts - Sls U - Return U"

13. Return Inventory (Return Inv)
    - Type: Special (set from 4 weeks prior)
    - Formula: None (computed as Return U * 0.9 from 4 weeks ago)

(Additional KPIs for dollars: BOP $, EOP $, etc.)
```

---

## Glossary

- **DAG:** Directed Acyclic Graph - graph structure with directed edges and no cycles
- **Topological Sort:** Algorithm to order nodes based on dependencies
- **Kahn's Algorithm:** Specific topological sort algorithm using in-degree counting
- **In-Degree:** Number of incoming edges to a node
- **Lock Strategy:** Rules defining which KPIs to prevent from recalculation
- **Multi-Week Effect:** Changes that propagate across different time periods
- **EOP:** End of Period - inventory/values at end of time period
- **BOP:** Beginning of Period - inventory/values at start of time period
- **Cascade:** Series of automatic recalculations triggered by one edit
- **Memoization:** Caching computed values to avoid redundant calculations

---

**Document Version:** 1.0
**Last Updated:** 2025-11-14
**Author:** KPI Engine Development Team
