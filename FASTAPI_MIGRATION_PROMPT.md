# KPI Rebalancing Engine - FastAPI Migration Prompt

## 🎯 MISSION

Build a production-ready **Python FastAPI application** that implements the KPI Rebalancing Engine. This system automatically recalculates interdependent retail/merchandising KPIs when users edit values, using graph theory (DAG), topological sorting, and configurable allocation strategies.

**Reference Codebase:** `/home/user/DAG/kpi-poc/` (TypeScript/React POC - approved and ready for production)

---

## 📋 TABLE OF CONTENTS

1. [System Overview](#system-overview)
2. [Core Concepts](#core-concepts)
3. [Architecture Requirements](#architecture-requirements)
4. [Database Schema](#database-schema)
5. [API Endpoints](#api-endpoints)
6. [Business Logic Implementation](#business-logic-implementation)
7. [Technical Stack](#technical-stack)
8. [Project Structure](#project-structure)
9. [Implementation Steps](#implementation-steps)
10. [Testing Requirements](#testing-requirements)
11. [Documentation Requirements](#documentation-requirements)

---

## 1. SYSTEM OVERVIEW

### What This System Does

**Problem:** When a merchandiser edits one KPI (e.g., Sales Units = 1000), dozens of dependent KPIs must recalculate automatically (COGS, Gross Margin, EOP Inventory, etc.) while respecting business constraints and multi-week effects.

**Solution:** A DAG-based rebalancing engine that:
- Automatically determines calculation order using topological sort
- Supports both granular edits (product-week level) and aggregated edits (department-year level)
- Distributes aggregated edits to granular storage using configurable allocation strategies
- Handles multi-week cascading effects (inventory transitions, delayed returns)
- Tracks all changes with comprehensive audit logging

### Key Features

1. **29 Interdependent KPIs** including sales, returns, margins, inventory, and planning metrics
2. **DAG-based dependency resolution** with Kahn's topological sort algorithm
3. **5 Allocation Strategies:** pro_rata, equal, historical, weighted, custom
4. **Lock Strategies** to maintain business constraints during recalculation
5. **Multi-week effects:** EOP→BOP transitions, 4-week delayed returns with damage factor
6. **AggregationContext:** TIME, HIERARCHY, WHERE, GRANULARITY for distributing aggregated edits
7. **Workflow generation** for external execution frameworks
8. **Comprehensive audit logging** distinguishing user edits from system recalculations

---

## 2. CORE CONCEPTS

### 2.1 DAG (Directed Acyclic Graph)

KPI dependencies form a directed acyclic graph:

```
Editable KPIs (Input)
    ↓
Sls U, Sls $, DR%, Return %, AUC, BOP U, Total Rcpt U
    ↓
Level 1 Calculations
    ↓
AUR = Sls $ / Sls U
COGS = Sls U * AUC
Return U = Return % * Sls U
    ↓
Level 2 Calculations
    ↓
GM $ = Sls $ - COGS
Net Sls U = Sls U - Return U
    ↓
Level 3+ Calculations
    ↓
GM % = GM $ / Sls $
EOP U = BOP U - Sls U + Total Rcpt U + Return Inv
```

**Critical Rules:**
- **No cycles** allowed (validated at startup)
- **Topological sort** determines correct calculation order
- **Levels can be parallel** (all KPIs in same level calculated simultaneously)

### 2.2 Topological Sort (Kahn's Algorithm)

**Purpose:** Determine correct calculation order for dependent KPIs.

**Algorithm:**
1. Build dependency graph
2. Calculate in-degrees (number of dependencies)
3. Start with nodes with in-degree = 0
4. Process level by level
5. Each level can be calculated in parallel

**Implementation Note:** See `kpi-poc/src/engine/topologicalSort.ts` lines 1-162

### 2.3 Allocation Strategies

When a user edits at an **aggregated level** (e.g., "Electronics department, 2024"), the system must **distribute** to **granular storage** (product-week level).

**5 Strategies:**

| Strategy | Description | Use Case | Weight Calculation |
|----------|-------------|----------|-------------------|
| **pro_rata** | Proportional to current values | Maintain current mix | `weight = current_value / total_value` |
| **equal** | Distribute evenly | Percentages, flat inventory | `weight = 1 / record_count` |
| **historical** | Based on past patterns | Seasonal data (year-level) | `weight = avg_historical / total_historical` |
| **weighted** | Priority-based (A/B/C tiers) | Strategic allocation | `weight = tier_weight / total_weight` |
| **custom** | User-provided SQL | Complex business rules | Custom SQL query |

**Key Principle:** Allocation strategy is **defined per KPI** in the config, NOT in the edit context.

**Example:**
```python
# KPI Config for "Sls U"
{
    "name": "Sls U",
    "allocation_strategy": {
        "default": {"strategy": "pro_rata"},
        "time": {
            "year": {
                "strategy": "historical",
                "historical": {"lookback_years": 2, "same_time_period": True}
            }
        }
    }
}

# When user edits:
# - "Electronics, January 2024, Sls U = 50,000" → uses "default" (pro_rata)
# - "Electronics, 2024, Sls U = 500,000" → uses "time.year" (historical)
```

### 2.4 AggregationContext

Describes WHERE the user is editing when it's at an aggregated level.

**4 Required Components:**

#### 1. TIME (Optional)
Defines temporal aggregation level.

```python
{
    "level": "month",  # year, quarter, month, week
    "sql_expression": "toMonth(toDate(year, 1, 1) + toIntervalWeek(week))"
}
```

**When to use:** User editing at aggregated time level (year/quarter/month)
**When optional:** Editing specific week OR no time filtering

#### 2. HIERARCHY (Optional)
Defines organizational aggregation level.

```python
{
    "level": "dept",  # dept, subdept, category, etc.
    "levels": ["dept"]  # All hierarchy columns at this level
}
```

**When to use:** User editing at aggregated hierarchy level (dept/subdept/category)
**When optional:** Editing specific product OR no hierarchy filtering

#### 3. WHERE (Required)
SQL filter clause specifying which records to include.

```python
where = "dept = 'Electronics' AND toMonth(toDate(year, 1, 1) + toIntervalWeek(week)) = 1 AND year = 2024"
```

**Always required** when using AggregationContext.

#### 4. GRANULARITY (Required)
Target columns for distribution (storage-level dimensions).

```python
granularity = ["product_id", "week", "year"]
```

**Definition:** The dimensional columns that uniquely identify one fact row (one "atom").

**Example:**
- Table has: `product_id, product_name, week, year, sls_u, sls_dollars, ...`
- Granularity: `["product_id", "week", "year"]` (dimensions)
- NOT granularity: `product_name` (attribute), `sls_u` (fact)

**Always required** when using AggregationContext.

### 2.5 Lock Strategies

**Purpose:** Prevent certain KPIs from being recalculated to maintain business constraints.

**Example:**
```python
# When user edits "Sls U", lock "DR%" and "Return %"
{
    "name": "Sls U",
    "locks_when_edited": ["DR%", "Return %"]
}
```

**Why?** If Sales Units change but Discount Rate % stays fixed, then Sales Dollars must adjust to maintain the relationship.

### 2.6 Multi-Week Effects

**EOP → BOP Transition:**
```
Week N EOP Units → Week N+1 BOP Units
```
End-of-period inventory becomes beginning-of-period for next week.

**Return Inventory (4-Week Delay):**
```
Week N Return Units * 0.9 → Week N+4 Return Inventory
```
Returns from Week N become damaged inventory in Week N+4 (10% damage factor).

---

## 3. ARCHITECTURE REQUIREMENTS

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   FastAPI Application                    │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────┐     ┌──────────────┐                  │
│  │  API Layer   │────>│ Service Layer│                  │
│  │  (FastAPI)   │     │ (Business    │                  │
│  └──────────────┘     │  Logic)      │                  │
│                        └──────────────┘                  │
│                               │                          │
│                               v                          │
│                   ┌──────────────────────┐              │
│                   │   KPI Engine Core    │              │
│                   │  - Topological Sort  │              │
│                   │  - Formula Eval      │              │
│                   │  - Multi-Week Logic  │              │
│                   └──────────────────────┘              │
│                               │                          │
│                               v                          │
│                   ┌──────────────────────┐              │
│                   │  Workflow Generator  │              │
│                   │  - Allocation Logic  │              │
│                   │  - SQL Generation    │              │
│                   └──────────────────────┘              │
│                               │                          │
│                               v                          │
│                   ┌──────────────────────┐              │
│                   │   ClickHouse Client  │              │
│                   │   (Data Layer)       │              │
│                   └──────────────────────┘              │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Execution Modes

**Mode 1: In-Memory (POC/Testing)**
- Fast in-memory calculations
- No database required
- Good for testing and demos

**Mode 2: ClickHouse Production**
- Generates SQL workflows
- Executes on ClickHouse for scale
- Supports 95GB+ datasets

**Requirement:** Support both modes with a configuration flag.

---

## 4. DATABASE SCHEMA

### 4.1 ClickHouse Tables

**Reference:** `kpi-poc/clickhouse/schema.sql`

#### Table: `kpi_config`
Stores KPI configurations (formulas, dependencies, allocation strategies).

```sql
CREATE TABLE kpi_config (
    kpi_name String,
    display_name String,
    is_editable UInt8,
    formula Nullable(String),
    description Nullable(String),
    depends_on String DEFAULT '[]',  -- JSON array
    locks_when_edited String DEFAULT '[]',  -- JSON array
    affects_weeks String DEFAULT '[]',  -- JSON array
    allocation_strategy Nullable(String),  -- JSON object
    allocation_validation Nullable(String),  -- JSON object
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now(),
    version UInt32 DEFAULT 1
)
ENGINE = ReplacingMergeTree(version)
ORDER BY (kpi_name);
```

#### Table: `kpi_data`
Stores actual KPI values per product per week.

```sql
CREATE TABLE kpi_data (
    -- DIMENSIONS (Granularity)
    product_id String,
    product_name String,
    week UInt8,
    year UInt16,

    -- FACTS (29 KPIs)
    sls_u Float64 DEFAULT 0,
    sls_dollars Float64 DEFAULT 0,
    aur Float64 DEFAULT 0,
    auc Float64 DEFAULT 0,
    dr_percent Float64 DEFAULT 0,
    return_percent Float64 DEFAULT 0,
    return_u Float64 DEFAULT 0,
    return_dollars Float64 DEFAULT 0,
    cogs Float64 DEFAULT 0,
    gm_dollars Float64 DEFAULT 0,
    gm_percent Float64 DEFAULT 0,
    net_sls_u Float64 DEFAULT 0,
    net_sls_dollars Float64 DEFAULT 0,
    bop_u Float64 DEFAULT 0,
    bop_dollars Float64 DEFAULT 0,
    eop_u Float64 DEFAULT 0,
    eop_dollars Float64 DEFAULT 0,
    total_rcpt_u Float64 DEFAULT 0,
    total_rcpt_dollars Float64 DEFAULT 0,
    return_inv Float64 DEFAULT 0,
    fwos Float64 DEFAULT 0,
    rec_rcpt_u Float64 DEFAULT 0,
    rec_rcpt_dollars Float64 DEFAULT 0,

    -- Metadata
    last_edited_kpi Nullable(String),
    last_edited_timestamp Nullable(DateTime),
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
ORDER BY (product_id, year, week)
PARTITION BY (product_id, year);
```

#### Table: `kpi_audit_log`
Tracks all changes (user edits and system recalculations).

```sql
CREATE TABLE kpi_audit_log (
    id UUID DEFAULT generateUUIDv4(),
    timestamp DateTime DEFAULT now(),
    log_type Enum8('user-edit' = 1, 'system-recalc' = 2),
    product_id String,
    week UInt8,
    year UInt16,
    kpi_name String,
    old_value Float64,
    new_value Float64,
    triggered_by Nullable(String),
    calculation_level Nullable(UInt8),
    formula Nullable(String),
    user_id Nullable(String)
)
ENGINE = MergeTree()
ORDER BY (product_id, timestamp)
PARTITION BY toYYYYMM(timestamp);
```

---

## 5. API ENDPOINTS

### 5.1 KPI Configuration Endpoints

#### GET `/api/kpis`
Get all KPI configurations.

**Response:**
```json
{
  "kpis": [
    {
      "name": "Sls U",
      "display_name": "Sales Units",
      "is_editable": true,
      "formula": null,
      "depends_on": [],
      "locks_when_edited": ["DR%", "Return %"],
      "description": "Total units sold in the period",
      "allocation_strategy": {
        "default": {"strategy": "pro_rata"},
        "time": {
          "year": {
            "strategy": "historical",
            "historical": {"lookback_years": 2, "same_time_period": true}
          }
        }
      },
      "allocation_validation": {
        "validate_sum": true,
        "tolerance": 0.01,
        "on_validation_failure": "error"
      }
    }
  ]
}
```

#### POST `/api/kpis`
Create or update KPI configuration.

**Request:**
```json
{
  "name": "New KPI",
  "display_name": "New KPI Display Name",
  "is_editable": false,
  "formula": "Sls U * AUC",
  "depends_on": ["Sls U", "AUC"],
  "locks_when_edited": [],
  "description": "Description here"
}
```

### 5.2 Data Endpoints

#### GET `/api/data/product/{product_id}`
Get all weeks of data for a product.

**Query Parameters:**
- `start_week` (optional)
- `end_week` (optional)
- `year` (optional)

**Response:**
```json
{
  "product_id": "PROD-001",
  "product_name": "iPhone Case - Premium",
  "weeks": [
    {
      "week": 8,
      "year": 2024,
      "values": {
        "Sls U": 90,
        "Sls $": 900,
        "AUR": 10,
        "AUC": 6,
        "DR%": 0.2,
        "COGS": 540,
        "GM $": 360,
        "GM %": 0.4
      }
    }
  ]
}
```

### 5.3 Edit Endpoints

#### POST `/api/edit/single`
Edit a single product-week KPI value.

**Request:**
```json
{
  "product_id": "PROD-001",
  "week": 10,
  "year": 2024,
  "kpi": "Sls U",
  "new_value": 150
}
```

**Response:**
```json
{
  "success": true,
  "updated_weeks": [10, 11, 12, 13],
  "affected_kpis": ["Sls U", "Sls $", "COGS", "GM $", "GM %", "EOP U", "EOP $"],
  "changes": [
    {
      "week": 10,
      "kpi": "Sls U",
      "old_value": 100,
      "new_value": 150
    },
    {
      "week": 10,
      "kpi": "COGS",
      "old_value": 600,
      "new_value": 900
    }
  ],
  "logs": [
    {
      "id": "1234567890-user-Sls U",
      "timestamp": "2024-03-15T10:30:00Z",
      "type": "user-edit",
      "kpi": "Sls U",
      "old_value": 100,
      "new_value": 150,
      "week": 10
    },
    {
      "id": "1234567890-system-COGS",
      "timestamp": "2024-03-15T10:30:01Z",
      "type": "system-recalc",
      "kpi": "COGS",
      "old_value": 600,
      "new_value": 900,
      "week": 10,
      "triggered_by": "Sls U",
      "calculation_level": 1,
      "formula": "Sls U * AUC"
    }
  ]
}
```

#### POST `/api/edit/aggregated`
Edit at aggregated level (department-month, etc.).

**Request:**
```json
{
  "kpi": "Sls U",
  "new_value": 50000,
  "aggregation_context": {
    "time": {
      "level": "month",
      "sql_expression": "toMonth(toDate(year, 1, 1) + toIntervalWeek(week))"
    },
    "hierarchy": {
      "level": "dept",
      "levels": ["dept"]
    },
    "where": "dept = 'Electronics' AND toMonth(toDate(year, 1, 1) + toIntervalWeek(week)) = 1 AND year = 2024",
    "granularity": ["product_id", "week", "year"]
  }
}
```

**Response:** Same structure as single edit, but affects multiple products/weeks.

### 5.4 Workflow Endpoints

#### POST `/api/workflow/generate`
Generate SQL workflow for aggregated edit.

**Request:** Same as `/api/edit/aggregated`

**Response:**
```json
{
  "workflow_id": "edit_Sls_U_1234567890",
  "description": "Edit Sls U at dept-month level",
  "steps": [
    {
      "step_id": "edit_Sls_U_1234567890_calculate_current",
      "description": "Calculate current aggregate value",
      "source_table": "kpi_data",
      "target_table": "tmp_edit_Sls_U_1234567890_current_aggregate",
      "process_sql": "SELECT ...",
      "cleanup_source": false,
      "dependencies": []
    },
    {
      "step_id": "edit_Sls_U_1234567890_calculate_weights",
      "description": "Calculate allocation weights using pro_rata strategy",
      "source_table": "kpi_data",
      "target_table": "tmp_edit_Sls_U_1234567890_weights",
      "process_sql": "SELECT ...",
      "cleanup_source": false,
      "dependencies": ["edit_Sls_U_1234567890_calculate_current"]
    }
  ],
  "memory_limits": {
    "max_memory_mb": 4096,
    "cleanup_threshold_mb": 3072
  },
  "max_parallel_steps": 4,
  "timeout_seconds": 300
}
```

### 5.5 Validation Endpoints

#### POST `/api/validate/dag`
Validate KPI configuration for cycles.

**Response:**
```json
{
  "valid": true,
  "cycles": []
}
```

#### POST `/api/validate/allocation`
Validate that distributed values sum correctly.

**Request:**
```json
{
  "kpi": "Sls U",
  "aggregation_context": { ... },
  "expected_total": 50000
}
```

**Response:**
```json
{
  "valid": true,
  "distributed_total": 50000,
  "difference": 0,
  "within_tolerance": true
}
```

### 5.6 Audit Endpoints

#### GET `/api/audit/logs`
Get audit log entries.

**Query Parameters:**
- `product_id` (optional)
- `start_date` (optional)
- `end_date` (optional)
- `kpi` (optional)
- `type` (optional): "user-edit" or "system-recalc"

**Response:**
```json
{
  "logs": [
    {
      "id": "uuid",
      "timestamp": "2024-03-15T10:30:00Z",
      "log_type": "user-edit",
      "product_id": "PROD-001",
      "week": 10,
      "year": 2024,
      "kpi_name": "Sls U",
      "old_value": 100,
      "new_value": 150,
      "triggered_by": null,
      "calculation_level": null,
      "formula": null,
      "user_id": "user123"
    }
  ]
}
```

---

## 6. BUSINESS LOGIC IMPLEMENTATION

### 6.1 KPI Engine Core

**File:** `app/engine/kpi_engine.py`

**Main Class:** `KPIRebalancingEngine`

**Key Methods:**

```python
class KPIRebalancingEngine:
    def __init__(self, configs: List[KPIConfig]):
        """Initialize with KPI configurations."""
        pass

    def rebalance(
        self,
        product_data: ProductData,
        week_number: int,
        edited_kpi: str,
        new_value: float
    ) -> RebalancingResult:
        """
        Main rebalancing method.

        Steps:
        1. Apply the user edit
        2. Handle special cases (e.g., Sls U → recalc Sls $ to maintain AUR)
        3. Get lock strategy
        4. Phase 1: Linear calculations (topological sort)
        5. Phase 2: Multi-week effects (EOP→BOP, returns)
        6. Return all changes and logs
        """
        pass
```

**Reference Implementation:** `kpi-poc/src/engine/KPIEngine.ts` lines 1-350

### 6.2 Topological Sort

**File:** `app/engine/topological_sort.py`

**Main Function:**

```python
def topological_sort(
    configs: Dict[str, KPIConfig],
    edited_kpi: str,
    locked_kpis: Set[str]
) -> List[List[str]]:
    """
    Kahn's algorithm for topological sorting.

    Returns:
        List of levels, where each level is a list of KPIs
        that can be calculated in parallel.

    Example:
        [
            ["AUR", "COGS", "Return U"],  # Level 1
            ["GM $", "Net Sls U"],         # Level 2
            ["GM %", "EOP U"]              # Level 3
        ]
    """
    # 1. Build dependency graph
    # 2. Calculate in-degrees
    # 3. Process level by level (BFS)
    # 4. Check for cycles
    pass
```

**Reference Implementation:** `kpi-poc/src/engine/topologicalSort.ts` lines 1-162

### 6.3 Formula Evaluation

**File:** `app/engine/formula_evaluator.py`

**Main Function:**

```python
def evaluate_formula(formula: str, values: Dict[str, float]) -> float:
    """
    Safely evaluate a formula string.

    Example:
        formula = "Sls $ / Sls U"
        values = {"Sls $": 1000, "Sls U": 100}
        result = 10.0

    Security:
        - Use ast.parse to validate formula
        - Only allow math operations (+, -, *, /, ^)
        - No function calls, imports, or arbitrary code
    """
    pass
```

**Reference Implementation:** `kpi-poc/src/engine/formulas.ts` lines 1-112

### 6.4 Allocation Strategy Implementation

**File:** `app/workflows/allocation.py`

**Functions for Each Strategy:**

```python
def allocate_pro_rata(
    kpi: str,
    where_clause: str,
    granularity: List[str]
) -> str:
    """
    Generate SQL for pro-rata allocation.

    Weight = current_value / SUM(current_value)
    """
    pass

def allocate_equal(
    where_clause: str,
    granularity: List[str]
) -> str:
    """
    Generate SQL for equal allocation.

    Weight = 1 / COUNT(*)
    """
    pass

def allocate_historical(
    kpi: str,
    where_clause: str,
    granularity: List[str],
    lookback_years: int,
    same_time_period: bool
) -> str:
    """
    Generate SQL for historical allocation.

    Weight = AVG(historical_value) / SUM(AVG(historical_value))
    """
    pass

def allocate_weighted(
    where_clause: str,
    granularity: List[str],
    weight_column: str,
    weight_mapping: Dict[str, float]
) -> str:
    """
    Generate SQL for weighted allocation.

    Weight = tier_weight / SUM(tier_weights)
    """
    pass
```

### 6.5 Workflow Generator

**File:** `app/workflows/workflow_generator.py`

**Main Function:**

```python
def generate_aggregated_edit_workflow(
    edited_kpi: str,
    edited_value: float,
    aggregation_context: AggregationContext,
    kpi_configs: List[KPIConfig]
) -> WorkflowDefinition:
    """
    Generate complete SQL workflow for aggregated edit.

    Steps:
    1. Calculate current aggregate
    2. Calculate weights (using KPI's allocation strategy)
    3. Calculate deltas
    4. Apply deltas to edited KPI
    5. Validate (if enabled)
    6. Rebalance dependent KPIs
    7. Handle multi-week effects

    Returns:
        WorkflowDefinition with all SQL steps
    """
    pass
```

**Reference Implementation:** `kpi-poc/src/workflows/workflowGenerator.ts` lines 1-500+

### 6.6 Multi-Week Effects

**File:** `app/engine/multi_week_effects.py`

**Functions:**

```python
def handle_eop_to_bop_transition(
    product_data: ProductData,
    start_week: int
) -> List[Change]:
    """
    EOP U (Week N) → BOP U (Week N+1)
    EOP $ (Week N) → BOP $ (Week N+1)

    Cascades through all subsequent weeks.
    """
    pass

def handle_return_inventory(
    product_data: ProductData,
    start_week: int,
    damage_rate: float = 0.1
) -> List[Change]:
    """
    Return U (Week N) * (1 - damage_rate) → Return Inv (Week N+4)

    Applies 4-week delay with 10% damage factor.
    """
    pass
```

---

## 7. TECHNICAL STACK

### 7.1 Required Python Packages

```
# Core Framework
fastapi==0.115.0
uvicorn[standard]==0.30.0
pydantic==2.9.0
pydantic-settings==2.5.0

# Database
clickhouse-driver==0.2.9
clickhouse-connect==0.8.0

# Async Support
asyncio
aiofiles==24.1.0

# Data Processing
pandas==2.2.0
numpy==2.1.0

# Formula Evaluation (Safe)
ast  # Built-in
sympy==1.13.0  # Optional: for advanced formula parsing

# Testing
pytest==8.3.0
pytest-asyncio==0.24.0
pytest-cov==5.0.0
httpx==0.27.0  # For testing FastAPI endpoints

# Development
black==24.8.0
ruff==0.6.0
mypy==1.11.0
```

### 7.2 Python Version

**Minimum:** Python 3.11+

### 7.3 Configuration

**Environment Variables:**
```env
# Server
HOST=0.0.0.0
PORT=8000
ENVIRONMENT=development  # development, staging, production

# Execution Mode
EXECUTION_MODE=memory  # memory, clickhouse

# ClickHouse
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=9000
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DATABASE=kpi_engine

# Logging
LOG_LEVEL=INFO
LOG_FORMAT=json

# Performance
MAX_PARALLEL_STEPS=4
WORKFLOW_TIMEOUT_SECONDS=300
MAX_MEMORY_MB=4096
```

---

## 8. PROJECT STRUCTURE

```
kpi-rebalancing-api/
├── app/
│   ├── __init__.py
│   ├── main.py                      # FastAPI app initialization
│   ├── config.py                    # Configuration (pydantic-settings)
│   │
│   ├── models/                      # Pydantic models
│   │   ├── __init__.py
│   │   ├── kpi.py                   # KPI models (KPIConfig, KPIName, etc.)
│   │   ├── data.py                  # Data models (WeekData, ProductData)
│   │   ├── workflow.py              # Workflow models
│   │   ├── aggregation.py           # AggregationContext models
│   │   └── allocation.py            # AllocationStrategy models
│   │
│   ├── api/                         # API routes
│   │   ├── __init__.py
│   │   ├── kpis.py                  # KPI config endpoints
│   │   ├── data.py                  # Data endpoints
│   │   ├── edits.py                 # Edit endpoints
│   │   ├── workflows.py             # Workflow endpoints
│   │   ├── validation.py            # Validation endpoints
│   │   └── audit.py                 # Audit log endpoints
│   │
│   ├── services/                    # Business logic
│   │   ├── __init__.py
│   │   ├── kpi_service.py           # KPI CRUD operations
│   │   ├── data_service.py          # Data CRUD operations
│   │   ├── edit_service.py          # Edit orchestration
│   │   └── workflow_service.py      # Workflow generation
│   │
│   ├── engine/                      # Core engine logic
│   │   ├── __init__.py
│   │   ├── kpi_engine.py            # Main rebalancing engine
│   │   ├── topological_sort.py      # Kahn's algorithm
│   │   ├── formula_evaluator.py     # Safe formula evaluation
│   │   ├── multi_week_effects.py    # EOP→BOP, returns
│   │   └── custom_handlers.py       # Custom KPI logic (if needed)
│   │
│   ├── workflows/                   # Workflow generation
│   │   ├── __init__.py
│   │   ├── workflow_generator.py    # Main workflow builder
│   │   ├── allocation.py            # Allocation strategy SQL
│   │   └── sql_builder.py           # SQL query builder utilities
│   │
│   ├── db/                          # Database layer
│   │   ├── __init__.py
│   │   ├── clickhouse.py            # ClickHouse client
│   │   ├── kpi_dal.py               # KPI data access layer
│   │   ├── data_dal.py              # KPI data CRUD
│   │   └── audit_dal.py             # Audit log CRUD
│   │
│   └── utils/                       # Utilities
│       ├── __init__.py
│       ├── logger.py                # Logging setup
│       └── validators.py            # Custom validators
│
├── data/                            # Static data files
│   ├── kpi_configs.json             # Initial KPI configurations
│   └── seed_data.json               # Sample data (optional)
│
├── tests/                           # Tests
│   ├── __init__.py
│   ├── conftest.py                  # Pytest fixtures
│   ├── unit/
│   │   ├── test_topological_sort.py
│   │   ├── test_formula_evaluator.py
│   │   ├── test_allocation.py
│   │   └── test_kpi_engine.py
│   ├── integration/
│   │   ├── test_edit_single.py
│   │   ├── test_edit_aggregated.py
│   │   └── test_multi_week.py
│   └── api/
│       ├── test_kpis_api.py
│       ├── test_data_api.py
│       └── test_edits_api.py
│
├── scripts/                         # Utility scripts
│   ├── init_db.py                   # Initialize ClickHouse schema
│   ├── seed_db.py                   # Seed sample data
│   └── migrate.py                   # Database migrations
│
├── docs/                            # Documentation
│   ├── API.md                       # API documentation
│   ├── ARCHITECTURE.md              # Architecture guide
│   └── DEPLOYMENT.md                # Deployment guide
│
├── .env.example                     # Example environment variables
├── requirements.txt                 # Python dependencies
├── pyproject.toml                   # Project config (black, ruff, mypy)
├── Dockerfile                       # Docker image
├── docker-compose.yml               # Local development setup
└── README.md                        # Project README
```

---

## 9. IMPLEMENTATION STEPS

### Phase 1: Foundation (Day 1-2)

1. **Project Setup**
   - Initialize FastAPI project structure
   - Set up virtual environment
   - Install dependencies
   - Configure linting (black, ruff, mypy)
   - Set up pytest

2. **Models Definition**
   - Define all Pydantic models (refer to `kpi-poc/src/types.ts`)
   - KPIConfig, KPIName enum, WeekData, ProductData
   - AggregationContext, AllocationStrategy
   - WorkflowDefinition, WorkflowStep
   - Request/Response models

3. **Configuration**
   - Environment variable loading
   - Configuration validation
   - Mode selection (memory vs clickhouse)

### Phase 2: Core Engine (Day 3-5)

4. **Topological Sort**
   - Implement Kahn's algorithm
   - Add cycle detection
   - Add validation helpers
   - Write unit tests

5. **Formula Evaluator**
   - Implement safe formula evaluation using AST
   - Add validation for allowed operations
   - Handle edge cases (division by zero)
   - Write unit tests

6. **KPI Engine Core**
   - Implement main rebalancing logic
   - Handle special cases (Sls U → Sls $)
   - Implement lock strategies
   - Phase 1: Linear calculations
   - Write unit tests

7. **Multi-Week Effects**
   - Implement EOP→BOP transitions
   - Implement 4-week return inventory
   - Cascading logic across weeks
   - Write unit tests

### Phase 3: Database Layer (Day 6-7)

8. **ClickHouse Client**
   - Set up ClickHouse connection
   - Connection pooling
   - Error handling

9. **Data Access Layer**
   - KPI config CRUD
   - KPI data CRUD
   - Audit log CRUD
   - Query builders

10. **Database Initialization**
    - Create schema initialization script
    - Create seed data script
    - Implement migrations

### Phase 4: Allocation & Workflows (Day 8-10)

11. **Allocation Strategies**
    - Implement pro_rata SQL generation
    - Implement equal SQL generation
    - Implement historical SQL generation
    - Implement weighted SQL generation
    - Write unit tests

12. **Workflow Generator**
    - Implement workflow step creation
    - Implement SQL query generation
    - Implement dependency tracking
    - Write unit tests

### Phase 5: API Layer (Day 11-13)

13. **KPI Endpoints**
    - GET /api/kpis
    - POST /api/kpis
    - GET /api/kpis/{name}
    - PUT /api/kpis/{name}
    - DELETE /api/kpis/{name}

14. **Data Endpoints**
    - GET /api/data/product/{product_id}
    - GET /api/data/week/{week}
    - POST /api/data/bulk

15. **Edit Endpoints**
    - POST /api/edit/single
    - POST /api/edit/aggregated

16. **Workflow Endpoints**
    - POST /api/workflow/generate
    - POST /api/workflow/execute (optional)

17. **Validation & Audit Endpoints**
    - POST /api/validate/dag
    - POST /api/validate/allocation
    - GET /api/audit/logs

### Phase 6: Testing & Documentation (Day 14-15)

18. **Integration Tests**
    - Test complete edit flows
    - Test multi-week cascading
    - Test aggregated edits with allocation

19. **API Tests**
    - Test all endpoints
    - Test error cases
    - Test validation

20. **Documentation**
    - API documentation (OpenAPI/Swagger)
    - Architecture guide
    - Deployment guide
    - README with examples

### Phase 7: Production Readiness (Day 16-17)

21. **Performance**
    - Add caching where appropriate
    - Optimize database queries
    - Add connection pooling

22. **Observability**
    - Structured logging
    - Error tracking
    - Metrics (optional)

23. **Docker & Deployment**
    - Create Dockerfile
    - Create docker-compose.yml
    - Deployment documentation

---

## 10. TESTING REQUIREMENTS

### 10.1 Unit Tests

**Must Cover:**
- Topological sort (including cycle detection)
- Formula evaluation (including edge cases)
- Each allocation strategy SQL generation
- Multi-week effect calculations
- Lock strategy application

**Minimum Coverage:** 80%

### 10.2 Integration Tests

**Must Cover:**
- Single product-week edit with cascading
- Aggregated edit with pro_rata allocation
- Aggregated edit with historical allocation
- Multi-week cascading (EOP→BOP)
- Return inventory with 4-week delay
- Complete workflow generation

### 10.3 API Tests

**Must Cover:**
- All endpoints (happy path)
- Error cases (400, 404, 500)
- Validation errors
- Authentication (if implemented)

### 10.4 Test Data

Use the same test data from `kpi-poc/src/data/initialData.ts`:
- Product: PROD-001 (iPhone Case - Premium)
- Weeks: 8-15
- Year: 2024

---

## 11. DOCUMENTATION REQUIREMENTS

### 11.1 API Documentation

- Use FastAPI's built-in OpenAPI/Swagger
- Add detailed descriptions for each endpoint
- Provide request/response examples
- Document error codes

### 11.2 Architecture Documentation

**Must Include:**
- System architecture diagram
- Component descriptions
- Data flow diagrams
- Execution mode comparison

### 11.3 Deployment Guide

**Must Include:**
- Docker setup instructions
- Environment variable reference
- ClickHouse initialization steps
- Production deployment checklist

### 11.4 README

**Must Include:**
- Project overview
- Quick start guide
- Example API calls (curl/httpie)
- Development setup
- Testing instructions

---

## 12. CRITICAL IMPLEMENTATION NOTES

### 12.1 Security

1. **Formula Evaluation:**
   - NEVER use `eval()` or `exec()`
   - Use `ast.parse()` to validate formulas
   - Only allow math operations: `+`, `-`, `*`, `/`, `**`
   - No function calls, imports, or attribute access

2. **SQL Injection:**
   - Always use parameterized queries
   - Validate all input from aggregation context
   - Sanitize column names from granularity

3. **Authentication (Future):**
   - Placeholder for user_id in audit logs
   - JWT tokens or API keys

### 12.2 Performance

1. **Memory Mode:**
   - Keep data in-memory as Python dicts/lists
   - Deep copy before modifications
   - Suitable for <1000 products

2. **ClickHouse Mode:**
   - Generate SQL, don't fetch all data
   - Use temp tables for workflows
   - Batch operations where possible
   - Suitable for 95GB+ datasets

3. **Caching:**
   - Cache KPI configs (rarely change)
   - Cache topological sort results
   - Invalidate on config update

### 12.3 Error Handling

1. **User Edits:**
   - Validate KPI exists
   - Validate week exists
   - Validate value is numeric
   - Return clear error messages

2. **DAG Validation:**
   - Check for cycles on startup
   - Check for cycles on config update
   - Provide cycle path in error

3. **Allocation:**
   - Validate sum within tolerance
   - Handle division by zero gracefully
   - Provide detailed validation reports

### 12.4 Logging

**Use Structured Logging:**
```python
logger.info(
    "Edit applied",
    extra={
        "product_id": product_id,
        "week": week,
        "kpi": kpi,
        "old_value": old_value,
        "new_value": new_value,
        "execution_mode": execution_mode
    }
)
```

---

## 13. REFERENCE FILES TO STUDY

### Critical TypeScript Files to Port

1. **`kpi-poc/src/types.ts`** (158 lines)
   - All type definitions
   - Port to Pydantic models

2. **`kpi-poc/src/engine/KPIEngine.ts`** (350 lines)
   - Main rebalancing algorithm
   - Port to `app/engine/kpi_engine.py`

3. **`kpi-poc/src/engine/topologicalSort.ts`** (162 lines)
   - Kahn's algorithm implementation
   - Port to `app/engine/topological_sort.py`

4. **`kpi-poc/src/engine/formulas.ts`** (112 lines)
   - Formula evaluation
   - Port to `app/engine/formula_evaluator.py`

5. **`kpi-poc/src/data/kpiConfig.ts`** (270 lines)
   - All 29 KPI definitions
   - Convert to JSON in `data/kpi_configs.json`

6. **`kpi-poc/src/workflows/workflowGenerator.ts`** (500+ lines)
   - Workflow generation logic
   - Port to `app/workflows/workflow_generator.py`

7. **`kpi-poc/src/workflows/types.ts`** (101 lines)
   - Workflow and aggregation types
   - Port to `app/models/workflow.py` and `app/models/aggregation.py`

8. **`kpi-poc/clickhouse/schema.sql`** (160 lines)
   - Database schema
   - Use directly for ClickHouse initialization

### Documentation to Reference

1. **`kpi-poc/TECHNICAL_DOCUMENTATION.md`** (1487 lines)
   - Comprehensive system guide
   - Business logic explanations

2. **`kpi-poc/AGGREGATION_CONTEXT_REFERENCE.md`** (333 lines)
   - Deep dive into TIME/HIERARCHY/WHERE/GRANULARITY

3. **`kpi-poc/WORKFLOW_ALLOCATION_GUIDE.md`**
   - Allocation strategies explained

---

## 14. SUCCESS CRITERIA

### Functional Requirements
✅ All 29 KPIs configurable
✅ Single product-week edits work correctly
✅ Aggregated edits distribute correctly
✅ All 5 allocation strategies implemented
✅ Multi-week cascading works
✅ Audit logging captures all changes
✅ DAG validation prevents cycles
✅ Both execution modes work (memory & ClickHouse)

### Technical Requirements
✅ All API endpoints functional
✅ 80%+ test coverage
✅ Type hints on all functions
✅ Structured logging
✅ Docker deployment works
✅ Documentation complete

### Performance Requirements
✅ Single edit: <100ms response time (memory mode)
✅ Aggregated edit: <5s for 1000 records (ClickHouse mode)
✅ Workflow generation: <1s

---

## 15. GETTING STARTED

### Step 1: Environment Setup
```bash
# Create project directory
mkdir kpi-rebalancing-api
cd kpi-rebalancing-api

# Create virtual environment
python3.11 -m venv venv
source venv/bin/activate

# Install dependencies
pip install fastapi uvicorn pydantic clickhouse-driver pytest
```

### Step 2: Project Structure
```bash
# Create directory structure
mkdir -p app/{models,api,services,engine,workflows,db,utils}
mkdir -p tests/{unit,integration,api}
mkdir -p data scripts docs
```

### Step 3: First Model
Start with `app/models/kpi.py`:
```python
from enum import Enum
from typing import List, Optional
from pydantic import BaseModel

class KPIName(str, Enum):
    SLS_U = "Sls U"
    SLS_DOLLARS = "Sls $"
    AUR = "AUR"
    # ... add all 29 KPIs

class KPIConfig(BaseModel):
    name: KPIName
    display_name: str
    is_editable: bool
    formula: Optional[str] = None
    depends_on: List[KPIName] = []
    locks_when_edited: List[KPIName] = []
    description: Optional[str] = None
```

### Step 4: First Test
Start with `tests/unit/test_topological_sort.py`:
```python
import pytest
from app.engine.topological_sort import topological_sort

def test_simple_dag():
    # Test cases from kpi-poc
    pass
```

---

## 16. QUESTIONS TO CONSIDER

Before starting implementation, consider:

1. **Authentication:** Will this API need authentication? (JWT, API keys, etc.)
2. **Rate Limiting:** Should we add rate limiting to prevent abuse?
3. **Async vs Sync:** Should ClickHouse queries be async?
4. **Caching:** What should be cached? Redis? In-memory?
5. **Monitoring:** Prometheus metrics? New Relic? DataDog?
6. **CI/CD:** GitHub Actions? GitLab CI?

---

## 17. FINAL NOTES

This is a **production migration** of a **proven POC**. The TypeScript implementation in `kpi-poc/` is your source of truth for business logic.

**Key Principles:**
1. **Don't reinvent** - Port the proven logic
2. **Test thoroughly** - Match POC behavior exactly
3. **Document clearly** - Future maintainers will thank you
4. **Think production** - Security, performance, observability
5. **Stay faithful** - Business logic is complex, don't simplify

**When in doubt, check the TypeScript reference implementation!**

Good luck! 🚀
