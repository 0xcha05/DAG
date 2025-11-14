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
9. [Dynamic KPI Templates](#dynamic-kpi-templates)

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
- **Configuration-driven KPI templates** - add new KPIs without code changes

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

## Dynamic KPI Templates

### Overview

One of the most powerful features of the KPI Rebalancing Engine is its **configuration-driven architecture**. KPIs are defined as data templates rather than hard-coded logic, making the system highly flexible and extensible.

**Key Benefit:** Add new KPIs or modify existing ones without changing any code—just update the configuration file.

### KPI Configuration Structure

Each KPI is defined by a template with the following properties:

```
{
  name: "COGS",                          // Unique identifier
  displayName: "Cost of Goods Sold",    // Human-readable name
  isEditable: false,                     // Can user edit directly?
  formula: "Sls U * AUC",               // Mathematical formula (optional)
  dependsOn: ["Sls U", "AUC"],          // Explicit dependencies (optional)
  locksWhenEdited: [],                   // KPIs to lock when this is edited
  description: "Total cost of units sold", // Help text
  affectsWeeks: [                        // Multi-week effects (optional)
    {
      offset: 4,                         // Number of weeks in future
      targetKPI: "Return Inv"            // Which KPI to affect
    }
  ]
}
```

### Template Properties Explained

#### 1. **name** (Required)
- Unique identifier for the KPI
- Used in formulas to reference this KPI
- Example: `"Sls U"`, `"COGS"`, `"GM %"`

#### 2. **displayName** (Optional)
- Human-readable name shown in UI
- If not provided, uses `name`
- Example: `"Sales Units"` instead of `"Sls U"`

#### 3. **isEditable** (Required)
- `true`: User can directly edit this value in the grid
- `false`: Value is calculated from formula only
- Example: `Sls U` is editable, `COGS` is not

#### 4. **formula** (Optional)
- Mathematical expression for calculating this KPI
- Uses other KPI names as variables
- Supports: `+`, `-`, `*`, `/`, `^`, `()`
- Example: `"(Sls $ - COGS) / Sls $ * 100"`

#### 5. **dependsOn** (Optional)
- Explicit list of KPIs this one depends on
- Can be auto-extracted from formula
- Useful for KPIs without formulas (like BOP from EOP)
- Example: `["Sls $", "COGS"]`

#### 6. **locksWhenEdited** (Optional)
- KPIs that should NOT be recalculated when this KPI is edited
- Implements lock strategies for business constraints
- Example: When editing `Sls U`, lock `["DR%", "Return %"]`

#### 7. **affectsWeeks** (Optional)
- Defines multi-week propagation effects
- Specifies which KPI to update in future weeks
- Example: `Return U` affects `Return Inv` 4 weeks later

### How the System Uses Templates

**Step 1: Load Configuration**
```
kpiConfigs = loadFromFile("kpiConfig.ts")
allKPIs = kpiConfigs.map(config => config.name)
```

**Step 2: Build Dependency Graph**
```
FOR EACH config IN kpiConfigs:
  IF config.formula:
    dependencies = extractVariablesFromFormula(config.formula)
  ELSE IF config.dependsOn:
    dependencies = config.dependsOn
  ELSE:
    dependencies = []

  // Add edges to DAG
  FOR EACH dep IN dependencies:
    addEdge(dep → config.name)
```

**Step 3: Determine Editability**
```
IF config.isEditable:
  enableEditing(config.name)
ELSE:
  disableEditing(config.name)
```

**Step 4: Apply Lock Strategies**
```
IF user edits config.name:
  lockedKPIs = config.locksWhenEdited
  skipRecalculating(lockedKPIs)
```

**Step 5: Handle Multi-Week Effects**
```
IF config.affectsWeeks:
  FOR EACH effect IN config.affectsWeeks:
    targetWeek = currentWeek + effect.offset
    updateKPI(targetWeek, effect.targetKPI)
```

### Example: Adding a New KPI

**Scenario:** Add "Net Gross Margin %" = Net GM $ / Net Sls $

**Step 1: Define Configuration**
```javascript
{
  name: "Net GM %",
  displayName: "Net Gross Margin %",
  isEditable: false,
  formula: "Net GM $ / Net Sls $ * 100",
  dependsOn: ["Net GM $", "Net Sls $"],
  locksWhenEdited: [],
  description: "Gross margin percentage after returns"
}
```

**Step 2: Add to Configuration Array**
```javascript
export const kpiConfigs: KPIConfig[] = [
  // ... existing KPIs ...

  {
    name: "Net GM %",
    displayName: "Net Gross Margin %",
    isEditable: false,
    formula: "Net GM $ / Net Sls $ * 100",
    dependsOn: ["Net GM $", "Net Sls $"],
    locksWhenEdited: [],
    description: "Gross margin percentage after returns"
  }
];
```

**Step 3: System Automatically:**
1. ✓ Extracts dependencies from formula: `["Net GM $", "Net Sls $"]`
2. ✓ Adds edges to DAG: `Net GM $ → Net GM %`, `Net Sls $ → Net GM %`
3. ✓ Updates topological sort to include new KPI in correct level
4. ✓ Renders new row in grid
5. ✓ Includes in DAG visualization
6. ✓ Recalculates when dependencies change

**No code changes required!** The system is fully configuration-driven.

### Example: Modifying an Existing KPI Formula

**Scenario:** Change COGS formula to include a shrinkage factor

**Before:**
```javascript
{
  name: "COGS",
  formula: "Sls U * AUC",
  dependsOn: ["Sls U", "AUC"]
}
```

**After:**
```javascript
{
  name: "COGS",
  formula: "Sls U * AUC * (1 + Shrinkage %)",
  dependsOn: ["Sls U", "AUC", "Shrinkage %"]
}
```

**System Automatically:**
1. ✓ Parses new formula
2. ✓ Extracts new dependency: `Shrinkage %`
3. ✓ Rebuilds DAG with new edge: `Shrinkage % → COGS`
4. ✓ Updates topological sort
5. ✓ Starts recalculating COGS when `Shrinkage %` changes

### Example: Complex Multi-Week KPI

**Scenario:** Add "Projected Stock Coverage" that looks 2 weeks ahead

**Configuration:**
```javascript
{
  name: "Stock Coverage",
  displayName: "Projected Stock Coverage (Weeks)",
  isEditable: false,
  dependsOn: ["EOP U", "Sls U"],
  locksWhenEdited: [],
  description: "Weeks of inventory based on current run rate",
  customCalculation: true  // Flag for special handling
}
```

**Custom Calculation Logic:**
```javascript
// In the engine, check for customCalculation flag
IF config.customCalculation AND config.name == "Stock Coverage":
  // Look ahead 2 weeks and sum projected sales
  projectedSales = 0
  FOR week FROM currentWeek TO currentWeek + 2:
    projectedSales += getData(week, "Sls U")

  eopUnits = getData(currentWeek, "EOP U")
  avgWeeklySales = projectedSales / 3

  stockCoverage = eopUnits / avgWeeklySales
  RETURN stockCoverage
```

### What Happens When You Update or Add a KPI

**Scenario: Adding a New KPI**

1. **Update Configuration File**
   - Add new KPI object to `kpiConfigs` array
   - Define formula, dependencies, editability, etc.

2. **System Detects Change**
   - On app reload, configuration is parsed
   - New KPI is discovered

3. **Dependency Graph Rebuilt**
   - Formula parsed to extract variable references
   - New edges added to DAG
   - Topological sort recalculated to include new KPI

4. **UI Automatically Updates**
   - New row appears in KPI Grid
   - New node appears in DAG Visualization
   - Config Editor shows new KPI properties

5. **Calculation Engine Updated**
   - New KPI included in recalculation cycles
   - Formula evaluator applies to new KPI
   - Change tracking logs include new KPI

6. **No Code Deployment Required**
   - Just update configuration file
   - System adapts automatically

**Scenario: Modifying a KPI Formula**

1. **Update Formula in Configuration**
   ```javascript
   // Before
   formula: "Sls U * AUC"

   // After
   formula: "Sls U * AUC * 1.1"  // Add 10% overhead
   ```

2. **System Detects Change**
   - Configuration reloaded
   - Formula string updated

3. **Dependencies Re-Extracted**
   - Formula parsed again
   - Dependencies confirmed (no change in this example)
   - DAG remains same (no new edges needed)

4. **Calculations Updated**
   - Next time KPI is calculated, new formula is used
   - Results immediately reflect formula change

5. **Historical Data Unaffected**
   - Only new calculations use new formula
   - Existing cell values remain until recalculated

**Scenario: Adding New Lock Strategy**

1. **Update Configuration**
   ```javascript
   {
     name: "DR%",
     isEditable: true,
     locksWhenEdited: ["AUR", "Sls U"]  // Added new locks
   }
   ```

2. **System Behavior**
   - When user edits DR%, system reads `locksWhenEdited`
   - AUR and Sls U are excluded from recalculation
   - All other KPIs recalculate normally

3. **No Engine Changes**
   - Lock strategy resolver reads from configuration
   - No code modification needed

### Benefits of Template-Driven Architecture

1. **Rapid Prototyping**
   - Test new KPIs in minutes, not hours
   - Experiment with different formulas easily
   - No development cycle needed

2. **Business User Empowerment**
   - Business analysts can define new metrics
   - No programmer required for formula changes
   - Self-service analytics modeling

3. **Maintainability**
   - All KPI logic in one place
   - Easy to audit and understand
   - Version control tracks changes

4. **Extensibility**
   - Add dozens of KPIs without code bloat
   - System scales with configuration size
   - No architectural changes needed

5. **Testing**
   - Easy to create test configurations
   - Validate formulas independently
   - A/B test different calculation approaches

6. **Documentation**
   - Configuration IS documentation
   - Self-describing system
   - Easy onboarding for new team members

### Configuration Validation

The system validates configurations on load:

```
FUNCTION validateConfiguration(kpiConfigs):
  errors = []

  // Check for duplicate names
  names = kpiConfigs.map(c => c.name)
  duplicates = findDuplicates(names)
  IF duplicates.length > 0:
    errors.add("Duplicate KPI names: " + duplicates)

  // Check formula references
  FOR EACH config IN kpiConfigs:
    IF config.formula:
      variables = extractVariables(config.formula)
      FOR EACH variable IN variables:
        IF variable NOT IN names:
          errors.add("Unknown KPI '" + variable + "' in formula for " + config.name)

  // Check for circular dependencies
  dag = buildDependencyGraph(kpiConfigs)
  cycles = detectCycles(dag)
  IF cycles.length > 0:
    errors.add("Circular dependencies detected: " + cycles)

  // Check lock strategy references
  FOR EACH config IN kpiConfigs:
    FOR EACH lockedKPI IN config.locksWhenEdited:
      IF lockedKPI NOT IN names:
        errors.add("Unknown KPI '" + lockedKPI + "' in lock strategy for " + config.name)

  IF errors.length > 0:
    THROW "Configuration validation failed: " + errors

  RETURN true
```

### Real-World Example: Full KPI Configuration

**Editable Base KPI:**
```javascript
{
  name: "Sls U",
  displayName: "Sales Units",
  isEditable: true,
  dependsOn: [],
  locksWhenEdited: ["DR%", "Return %"],
  description: "Total units sold in the period"
}
```

**Calculated KPI (Level 1):**
```javascript
{
  name: "COGS",
  displayName: "Cost of Goods Sold",
  isEditable: false,
  formula: "Sls U * AUC",
  dependsOn: ["Sls U", "AUC"],
  locksWhenEdited: [],
  description: "Total cost of units sold"
}
```

**Calculated KPI (Level 2):**
```javascript
{
  name: "GM $",
  displayName: "Gross Margin $",
  isEditable: false,
  formula: "Sls $ - COGS",
  dependsOn: ["Sls $", "COGS"],
  locksWhenEdited: [],
  description: "Gross profit in dollars"
}
```

**Multi-Week Effect KPI:**
```javascript
{
  name: "Return U",
  displayName: "Return Units",
  isEditable: false,
  formula: "Return % * Sls U",
  dependsOn: ["Return %", "Sls U"],
  locksWhenEdited: [],
  description: "Number of units returned",
  affectsWeeks: [
    {
      offset: 4,
      targetKPI: "Return Inv"
    }
  ]
}
```

---

## Conclusion

The KPI Rebalancing Engine demonstrates a powerful approach to managing interdependent metrics in retail merchandising. By leveraging graph theory (DAG), algorithmic sorting (Kahn's), and reactive UI patterns combined with a configuration-driven template system, the system provides:

✓ **Automatic recalculation** of dependent KPIs
✓ **Business constraint enforcement** via lock strategies
✓ **Multi-week effect handling** for realistic inventory modeling
✓ **Configuration-driven flexibility** allowing new KPIs without code changes
✓ **Template-based extensibility** for rapid prototyping and business user empowerment
✓ **Audit trail** distinguishing user edits from system recalculations

**Key Takeaways:**

1. **DAG + Topological Sort** ensures correct calculation order
2. **Lock strategies** maintain business rules during recalculation
3. **Multi-week effects** model real-world inventory transitions
4. **Configuration templates** enable rapid KPI addition and modification
5. **Formula parsing** automatically builds dependency relationships
6. **Comprehensive logging** provides auditability and transparency

This POC provides a foundation for production merchandising planning tools that can save analysts hours of manual work while reducing errors and improving decision-making quality. The template-driven architecture ensures the system can evolve with business needs without requiring development resources for every change.

---

**Document Version:** 1.0
**Last Updated:** 2025-11-14
**Author:** KPI Engine Development Team
