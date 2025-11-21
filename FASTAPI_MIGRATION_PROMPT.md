# KPI Workflow Generator - FastAPI Service

## 🎯 MISSION

Build a **Python FastAPI service** that generates SQL workflow JSON from client-specific KPI configurations. When a user edits a KPI value (either at granular or aggregated level), this service generates a complete workflow of SQL statements that maintain KPI relationships and business rules.

**Reference Codebase:** `/home/user/DAG/kpi-poc/` (TypeScript/React POC - approved for production)

---

## 📖 THE PROBLEM

### Business Context

Retail merchandisers work with **interdependent business metrics** (KPIs) like:
- Sales Units, Sales Dollars, Average Unit Retail
- Cost of Goods Sold, Gross Margin, Gross Margin %
- Beginning/End of Period Inventory, Receipts
- Return rates, Return Inventory
- Forward Weeks of Supply, Recommended Receipts

**The Challenge:** When a user edits one KPI, dozens of dependent KPIs must recalculate automatically while:
- Respecting mathematical relationships (e.g., AUR = Sales $ / Sales Units)
- Maintaining business constraints (e.g., if Sales Units change, keep Discount Rate fixed)
- Handling multi-week effects (e.g., this week's ending inventory becomes next week's beginning inventory)
- Supporting both granular edits (one product, one week) and aggregated edits (entire department, entire month)

### Current State

- **95GB+ datasets** across multiple clients (Spanx, etc.)
- **Complex dependencies:** Up to 29 interdependent KPIs
- **Two edit modes:**
  - Granular: Edit PROD-001, Week 10, Sales Units = 150
  - Aggregated: Edit Electronics dept, January 2024, Sales Units = 50,000 (distribute across all products/weeks)

### Why This is Hard

1. **Dependency ordering:** Must calculate KPIs in correct order (topological sort)
2. **Lock strategies:** Some KPIs lock others during recalculation (maintain business rules)
3. **Multi-week cascading:** Changes ripple through subsequent weeks (inventory transitions)
4. **Allocation strategies:** Aggregated edits need intelligent distribution (pro-rata, historical patterns, etc.)
5. **Client-specific logic:** Each client has unique KPI formulas and custom handlers

---

## 💾 THE DATA MODEL

### Storage Grain (Granularity)

Data is stored at **product-week-year** level:

```
kpi_data table:
┌────────────┬──────┬──────┬───────┬──────────┬─────┬──────┬─────────┐
│ product_id │ week │ year │ sls_u │ sls_$    │ aur │ cogs │ gm_$    │
├────────────┼──────┼──────┼───────┼──────────┼─────┼──────┼─────────┤
│ PROD-001   │ 8    │ 2024 │ 90    │ 900      │ 10  │ 540  │ 360     │
│ PROD-001   │ 9    │ 2024 │ 95    │ 950      │ 10  │ 570  │ 380     │
│ PROD-002   │ 8    │ 2024 │ 200   │ 2000     │ 10  │ 1200 │ 800     │
└────────────┴──────┴──────┴───────┴──────────┴─────┴──────┴─────────┘
```

**Granularity = `[product_id, week, year]`** - the unique key that identifies one row of data.

### Hierarchy Dimensions

Products are organized hierarchically:

```
Product Hierarchy:
Department (dept) → Sub-Department (subdept) → Category → Product

Example:
Electronics → Televisions → LED TVs → PROD-001
```

Users can edit at any level:
- **Granular:** PROD-001, Week 10 (one row)
- **Aggregated:** Electronics dept, January (many rows - distribute across all products/weeks)

### Time Dimensions

Data is stored at **week** level, but users can edit at:
- **Week:** Week 10 (granular)
- **Month:** January = Weeks 1-4 (aggregated)
- **Quarter:** Q1 = Weeks 1-13 (aggregated)
- **Year:** 2024 = Weeks 1-52 (aggregated)

---

## 🏗️ THE SOLUTION

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React)                         │
│                                                              │
│  User edits KPI → Sends payload                             │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│               FastAPI Workflow Generator                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Receive payload (auto-detect single vs aggregated)      │
│  2. Load client config (configs/spanx.json)                 │
│  3. Apply lock strategy                                     │
│  4. Topological sort → calculation order                    │
│  5. For each affected KPI:                                  │
│     ├─ Linear: formula → SQL                                │
│     └─ Custom: call Python handler → SQL                    │
│  6. Build workflow JSON with all SQL steps                  │
│                                                              │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  Workflow JSON Output                        │
│  (Executed by external system: Airflow, Dagster, etc.)      │
└─────────────────────────────────────────────────────────────┘
```

### Core Concepts

#### 1. DAG (Directed Acyclic Graph)

KPI dependencies form a graph:

```
Editable KPIs
    ↓
Sls U, Sls $, DR%, AUC, BOP U
    ↓
Level 1: Direct calculations
    ↓
AUR = Sls $ / Sls U
COGS = Sls U * AUC
    ↓
Level 2: Dependent calculations
    ↓
GM $ = Sls $ - COGS
    ↓
Level 3: Higher-level calculations
    ↓
GM % = GM $ / Sls $
```

**Topological sort** (Kahn's algorithm) determines correct calculation order.

#### 2. Two Handler Types

**Linear Handlers** (formula-based):
```json
{
  "name": "COGS",
  "handler_type": "linear",
  "formula": "Sls U * AUC",
  "depends_on": ["Sls U", "AUC"]
}
```
→ Generates: `UPDATE kpi_data SET cogs = sls_u * auc WHERE ...`

**Custom Handlers** (Python functions):
```json
{
  "name": "FWOS",
  "handler_type": "custom",
  "custom_handler": "spanx_fwos_handler",
  "handler_params": {"number_of_weeks": 6},
  "depends_on": ["EOP U", "Sls U"]
}
```
→ Calls: `spanx_fwos_handler(kpi_name, config, params, filters, ...)` → returns SQL

#### 3. Auto-Detection (Single vs Aggregated)

**Detection Rule:** If payload contains ALL granularity columns → Single. Otherwise → Aggregated.

```python
granularity = ["product_id", "week", "year"]  # From config

# Single edit (has all granularity):
payload = {"product_id": "PROD-001", "week": 10, "year": 2024, ...}
→ SINGLE (direct UPDATE)

# Aggregated edit (missing granularity):
payload = {"dept": "Electronics", "time_level": "month", "time_value": 1, "year": 2024, ...}
→ AGGREGATED (needs allocation/distribution)
```

#### 4. Allocation Strategies

When distributing aggregated edits to granular storage:

| Strategy | Description | Weight Formula |
|----------|-------------|----------------|
| **pro_rata** | Proportional to current values | `weight = current_value / sum(current_value)` |
| **equal** | Distribute evenly | `weight = 1 / count(*)` |
| **historical** | Based on past patterns (seasonal) | `weight = avg(past_value) / sum(avg(past_value))` |
| **weighted** | Priority-based (A/B/C tiers) | `weight = tier_weight / sum(tier_weight)` |

Strategy is defined **per KPI** in the config:
```json
{
  "name": "Sls U",
  "allocation_strategy": {
    "default": {"strategy": "pro_rata"},
    "time": {
      "year": {"strategy": "historical", "lookback_years": 2}
    }
  }
}
```

---

## 📥 INPUT: UNIFIED PAYLOAD

### Single Endpoint

**POST `/generate-workflow`**

One endpoint handles both edit types. Backend auto-detects based on granularity columns.

### Payload Structure

```json
{
  "kpi": "Sls U",
  "new_value": 50000,
  "year": 2024,

  // For SINGLE edit: specify ALL granularity columns
  "product_id": "PROD-001",
  "week": 10,

  // For AGGREGATED edit: specify hierarchy + time dimensions
  "dept": "Electronics",
  "time_level": "month",
  "time_value": 1
}
```

**Note:** Client is determined by `CLIENT_ID` environment variable, not from payload.

### Detection Logic

```python
def detect_edit_type(payload: dict, granularity: list[str]) -> str:
    """
    Auto-detect edit type based on presence of granularity columns.
    """
    has_all_granularity = all(
        col in payload and payload[col] is not None
        for col in granularity
    )
    return "single" if has_all_granularity else "aggregated"
```

### Example Payloads

**Example 1: Single Edit**
```json
{
  "kpi": "Sls U",
  "new_value": 150,
  "product_id": "PROD-001",
  "week": 10,
  "year": 2024
}
```
→ Edit one product, one week (direct UPDATE)

**Example 2: Aggregated Edit (Department + Month)**
```json
{
  "kpi": "Sls U",
  "new_value": 50000,
  "dept": "Electronics",
  "time_level": "month",
  "time_value": 1,
  "year": 2024
}
```
→ Edit all Electronics products, all weeks in January (needs allocation)

**Example 3: Aggregated Edit (Department + Year)**
```json
{
  "kpi": "Sls U",
  "new_value": 500000,
  "dept": "Electronics",
  "time_level": "year",
  "year": 2024
}
```
→ Edit all Electronics products, all weeks in 2024 (uses historical allocation)

---

## 🗂️ CLIENT CONFIG STRUCTURE

### Location (Client-Isolated)

```
configs/
├── spanx/
│   ├── kpi_config.json
│   └── settings.json (optional)
├── client2/
│   ├── kpi_config.json
│   └── settings.json (optional)
└── example/
    └── kpi_config.json
```

**Each client has a separate directory** for complete isolation. Client is loaded from environment variable `CLIENT_ID`.

### Config Schema

```json
{
  "client_id": "spanx",
  "database": "spanx_kpi_data",
  "data_table": "kpi_data",
  "granularity": ["product_id", "week", "year"],

  "kpis": [
    {
      "name": "Sls U",
      "display_name": "Sales Units",
      "is_editable": true,
      "handler_type": "linear",
      "formula": null,
      "depends_on": [],
      "locks_when_edited": ["DR%", "Return %"],
      "allocation_strategy": {
        "default": {"strategy": "pro_rata"},
        "time": {
          "year": {
            "strategy": "historical",
            "lookback_years": 2,
            "same_time_period": true
          }
        }
      }
    },
    {
      "name": "COGS",
      "display_name": "Cost of Goods Sold",
      "is_editable": false,
      "handler_type": "linear",
      "formula": "Sls U * AUC",
      "depends_on": ["Sls U", "AUC"],
      "locks_when_edited": []
    },
    {
      "name": "EOP U",
      "display_name": "End of Period Units",
      "is_editable": false,
      "handler_type": "custom",
      "custom_handler": "spanx_eop_bop_handler",
      "handler_params": {
        "offset": 1,
        "target_kpi": "BOP U"
      },
      "depends_on": ["BOP U", "Sls U", "Total Rcpt U", "Return Inv"],
      "locks_when_edited": []
    },
    {
      "name": "FWOS",
      "display_name": "Forward Weeks of Supply",
      "is_editable": false,
      "handler_type": "custom",
      "custom_handler": "spanx_fwos_handler",
      "handler_params": {
        "number_of_weeks": 6
      },
      "depends_on": ["EOP U", "Sls U"],
      "locks_when_edited": []
    }
  ]
}
```

### Key Config Fields

| Field | Description | Example |
|-------|-------------|---------|
| `granularity` | Storage grain (unique key) | `["product_id", "week", "year"]` |
| `handler_type` | "linear" or "custom" | `"linear"` |
| `formula` | For linear: SQL expression | `"Sls U * AUC"` |
| `custom_handler` | For custom: Python function name | `"spanx_fwos_handler"` |
| `handler_params` | Static params for custom handler | `{"number_of_weeks": 6}` |
| `depends_on` | KPIs this depends on (for topological sort) | `["Sls U", "AUC"]` |
| `locks_when_edited` | KPIs to lock when this is edited | `["DR%"]` |
| `allocation_strategy` | How to distribute aggregated edits | See allocation section |

### Why Granularity is Config-Only

**Granularity defines the storage schema** - it's where data lives, not where users edit.

**Usage:**
1. **Weight calculation:** `SELECT product_id, week, year, weight FROM ...`
2. **Delta application:** `UPDATE ... WHERE (product_id, week, year) IN (...)`
3. **Multi-week joins:** `WHERE source.product_id = target.product_id AND source.week = target.week - 1`

**Never from frontend** because:
- It's a database property, not an edit property
- User edits at aggregation level (dept-month)
- System distributes to storage level (product-week)
- They're different things!

### Loading Client Config (Environment-Based)

**Critical:** Client is determined by environment variable, ensuring complete isolation.

```python
import os
import json
from pathlib import Path
from functools import lru_cache

@lru_cache(maxsize=1)
def load_client_config() -> dict:
    """
    Load client config from environment.

    Environment variable:
        CLIENT_ID: Client identifier (e.g., "spanx", "client2")

    Returns:
        Client configuration dict

    Raises:
        ValueError: If CLIENT_ID not set or config not found
    """
    client_id = os.getenv("CLIENT_ID")
    if not client_id:
        raise ValueError("CLIENT_ID environment variable not set")

    config_dir = Path("configs") / client_id
    if not config_dir.exists():
        raise ValueError(f"Config directory not found for client: {client_id}")

    kpi_config_path = config_dir / "kpi_config.json"
    if not kpi_config_path.exists():
        raise ValueError(f"KPI config not found: {kpi_config_path}")

    with open(kpi_config_path) as f:
        config = json.load(f)

    # Validate client_id matches
    if config.get("client_id") != client_id:
        raise ValueError(f"Config client_id mismatch: expected {client_id}, got {config.get('client_id')}")

    return config
```

**Usage:**
```bash
# Start service for Spanx
export CLIENT_ID=spanx
uvicorn app.main:app --reload

# Start service for Client2
export CLIENT_ID=client2
uvicorn app.main:app --reload
```

**Benefits:**
- ✅ Complete client isolation (no risk of cross-client contamination)
- ✅ One deployment, multiple clients (via environment)
- ✅ Config caching with `@lru_cache`
- ✅ Consistent with handler directory structure
- ✅ Easy to add new clients (just create directory)

---

## 🔧 CUSTOM HANDLERS

### Purpose

Custom handlers implement complex KPI logic that can't be expressed as simple formulas:
- Multi-week effects (EOP → BOP transitions)
- Lookback calculations (FWOS, rolling averages)
- Delayed effects (return inventory with 4-week delay)
- Client-specific business rules

### Handler Interface

```python
from typing import Dict, Any, List

def custom_handler_interface(
    kpi_name: str,
    kpi_config: Dict[str, Any],
    handler_params: Dict[str, Any],
    filters: str,
    granularity: List[str],
    database: str,
    table: str
) -> str:
    """
    Returns SQL UPDATE statement for this KPI.

    Args:
        kpi_name: "EOP U", "FWOS", etc.
        kpi_config: Full KPI config dict
        handler_params: Static params from config (e.g., {"number_of_weeks": 6})
        filters: WHERE clause from edit (e.g., "product_id = 'PROD-001' AND week = 10")
        granularity: ["product_id", "week", "year"]
        database: "spanx_kpi_data"
        table: "kpi_data"

    Returns:
        SQL ALTER TABLE UPDATE statement
    """
    pass
```

### Directory Structure (Client-Specific)

```
app/engine/custom_handlers/
├── spanx/
│   ├── __init__.py
│   ├── spanx_fwos_handler.py
│   ├── spanx_eop_bop_handler.py
│   └── spanx_return_inv_handler.py
├── client2/
│   ├── __init__.py
│   └── client2_custom_handler.py
└── registry.py  # Maps handler names to functions
```

### Example 1: FWOS Handler

**Business Logic:** FWOS = End of Period Units / (average Sales Units over next N weeks)

```python
def spanx_fwos_handler(
    kpi_name: str,
    kpi_config: Dict[str, Any],
    handler_params: Dict[str, Any],
    filters: str,
    granularity: List[str],
    database: str,
    table: str
) -> str:
    """
    Forward Weeks of Supply calculation.
    FWOS = EOP U / AVG(Sls U over next N weeks)
    """
    number_of_weeks = handler_params.get("number_of_weeks", 6)

    sql = f"""
    ALTER TABLE {database}.{table} AS target
    UPDATE fwos = target.eop_u / (
        SELECT AVG(sls_u)
        FROM {database}.{table} AS future
        WHERE future.product_id = target.product_id
          AND future.year = target.year
          AND future.week > target.week
          AND future.week <= target.week + {number_of_weeks}
    )
    WHERE {filters}
    """
    return sql.strip()
```

### Example 2: EOP → BOP Handler

**Business Logic:** This week's EOP becomes next week's BOP (inventory transition)

```python
def spanx_eop_bop_handler(
    kpi_name: str,
    kpi_config: Dict[str, Any],
    handler_params: Dict[str, Any],
    filters: str,
    granularity: List[str],
    database: str,
    table: str
) -> str:
    """
    EOP to BOP transition handler.

    EOP U = BOP U - Sls U + Total Rcpt U + Return Inv
    BOP U (Week N) = EOP U (Week N-1)
    """
    if kpi_name == "EOP U":
        # Calculate EOP from formula
        sql = f"""
        ALTER TABLE {database}.{table}
        UPDATE eop_u = bop_u - sls_u + total_rcpt_u + return_inv
        WHERE {filters}
        """

    elif kpi_name == "BOP U":
        # Next week's BOP = this week's EOP
        offset = handler_params.get("offset", 1)
        sql = f"""
        ALTER TABLE {database}.{table} AS target
        UPDATE bop_u = (
            SELECT eop_u
            FROM {database}.{table} AS source
            WHERE source.product_id = target.product_id
              AND source.week = target.week - {offset}
              AND source.year = target.year
        )
        WHERE target.week > (
            SELECT MIN(week) FROM {database}.{table} WHERE {filters}
        )
        """

    return sql.strip()
```

### Example 3: Return Inventory Handler (4-week delay)

**Business Logic:** Returns from Week N become inventory in Week N+4 (with 10% damage)

```python
def spanx_return_inv_handler(
    kpi_name: str,
    kpi_config: Dict[str, Any],
    handler_params: Dict[str, Any],
    filters: str,
    granularity: List[str],
    database: str,
    table: str
) -> str:
    """
    Return Inventory with delay and damage factor.
    Return Inv (Week N+4) = Return U (Week N) * (1 - damage_rate)
    """
    offset = handler_params.get("offset", 4)
    damage_rate = handler_params.get("damage_rate", 0.1)

    sql = f"""
    ALTER TABLE {database}.{table} AS target
    UPDATE return_inv = (
        SELECT return_u * {1 - damage_rate}
        FROM {database}.{table} AS source
        WHERE source.product_id = target.product_id
          AND source.week = target.week - {offset}
          AND source.year = target.year
    )
    WHERE target.week > {offset}
      AND {filters}
    """
    return sql.strip()
```

### Handler Registry

**File:** `app/engine/custom_handlers/registry.py`

```python
from typing import Dict, Callable
from app.engine.custom_handlers.spanx.spanx_fwos_handler import spanx_fwos_handler
from app.engine.custom_handlers.spanx.spanx_eop_bop_handler import spanx_eop_bop_handler
from app.engine.custom_handlers.spanx.spanx_return_inv_handler import spanx_return_inv_handler

# Handler type signature
HandlerFunction = Callable[[str, Dict, Dict, str, list, str, str], str]

# Registry maps handler names to functions
CUSTOM_HANDLERS: Dict[str, HandlerFunction] = {
    "spanx_fwos_handler": spanx_fwos_handler,
    "spanx_eop_bop_handler": spanx_eop_bop_handler,
    "spanx_return_inv_handler": spanx_return_inv_handler,
    # Add more client handlers here
}

def get_handler(handler_name: str) -> HandlerFunction:
    """Get custom handler by name."""
    if handler_name not in CUSTOM_HANDLERS:
        raise ValueError(f"Unknown custom handler: {handler_name}")
    return CUSTOM_HANDLERS[handler_name]
```

---

## 📤 OUTPUT: WORKFLOW JSON

### Structure

```json
{
  "workflow_id": "spanx_edit_Sls_U_1234567890",
  "client_id": "spanx",
  "description": "Edit Sls U for PROD-001, Week 10, 2024",
  "steps": [
    {
      "step_id": "step_1_apply_edit",
      "description": "Apply user edit to Sls U",
      "sql": "ALTER TABLE spanx_kpi_data.kpi_data UPDATE sls_u = 150 WHERE product_id = 'PROD-001' AND week = 10 AND year = 2024",
      "dependencies": [],
      "cleanup": false
    },
    {
      "step_id": "step_2_recalc_cogs",
      "description": "Recalculate COGS (linear)",
      "sql": "ALTER TABLE spanx_kpi_data.kpi_data UPDATE cogs = sls_u * auc WHERE product_id = 'PROD-001' AND week = 10 AND year = 2024",
      "dependencies": ["step_1_apply_edit"],
      "cleanup": false
    },
    {
      "step_id": "step_3_recalc_eop_u",
      "description": "Recalculate EOP U (custom handler)",
      "sql": "ALTER TABLE spanx_kpi_data.kpi_data UPDATE eop_u = bop_u - sls_u + total_rcpt_u + return_inv WHERE product_id = 'PROD-001' AND week = 10 AND year = 2024",
      "dependencies": ["step_1_apply_edit"],
      "cleanup": false
    },
    {
      "step_id": "step_4_recalc_bop_u_next_week",
      "description": "Update next week's BOP U (multi-week effect)",
      "sql": "ALTER TABLE spanx_kpi_data.kpi_data AS target UPDATE bop_u = (SELECT eop_u FROM spanx_kpi_data.kpi_data AS source WHERE source.product_id = target.product_id AND source.week = 10 AND source.year = 2024) WHERE product_id = 'PROD-001' AND week = 11 AND year = 2024",
      "dependencies": ["step_3_recalc_eop_u"],
      "cleanup": false
    }
  ],
  "metadata": {
    "execution_mode": "clickhouse",
    "max_parallel_steps": 4,
    "timeout_seconds": 300,
    "edit_type": "single"
  }
}
```

### Workflow Execution

The workflow JSON is returned to the caller (frontend or orchestration system). **This service does NOT execute the workflow** - that's the responsibility of an external system like:
- Airflow
- Dagster
- Prefect
- Custom execution engine

---

## 🏗️ SERVICE ARCHITECTURE

### Directory Structure

```
kpi-workflow-generator/
├── app/
│   ├── main.py                      # FastAPI app
│   ├── config.py                    # Settings (env vars)
│   │
│   ├── models/
│   │   ├── __init__.py
│   │   ├── payload.py               # EditPayload (unified)
│   │   ├── kpi_config.py            # KPIConfig, ClientConfig
│   │   ├── workflow.py              # WorkflowDefinition, WorkflowStep
│   │   └── enums.py                 # HandlerType, AllocationStrategy, etc.
│   │
│   ├── services/
│   │   ├── __init__.py
│   │   ├── workflow_generator.py    # Main workflow builder
│   │   ├── config_loader.py         # Load/cache client configs
│   │   └── sql_builder.py           # SQL generation utilities
│   │
│   ├── engine/
│   │   ├── __init__.py
│   │   ├── topological_sort.py      # Kahn's algorithm
│   │   ├── formula_evaluator.py     # Convert formulas to SQL
│   │   └── custom_handlers/
│   │       ├── __init__.py
│   │       ├── registry.py          # Handler registry
│   │       ├── spanx/
│   │       │   ├── __init__.py
│   │       │   ├── spanx_fwos_handler.py
│   │       │   ├── spanx_eop_bop_handler.py
│   │       │   └── spanx_return_inv_handler.py
│   │       └── client2/
│   │           └── ...
│   │
│   └── allocation/
│       ├── __init__.py
│       ├── pro_rata.py              # Pro-rata SQL generator
│       ├── equal.py                 # Equal SQL generator
│       ├── historical.py            # Historical SQL generator
│       └── weighted.py              # Weighted SQL generator
│
├── configs/                         # Client-isolated configs
│   ├── spanx/
│   │   ├── kpi_config.json
│   │   └── settings.json (optional)
│   ├── client2/
│   │   ├── kpi_config.json
│   │   └── settings.json (optional)
│   └── example/
│       └── kpi_config.json
│
├── tests/
│   ├── __init__.py
│   ├── conftest.py                  # Pytest fixtures
│   ├── unit/
│   │   ├── test_topological_sort.py
│   │   ├── test_formula_evaluator.py
│   │   ├── test_allocation.py
│   │   └── test_custom_handlers.py
│   ├── integration/
│   │   ├── test_workflow_single.py
│   │   ├── test_workflow_aggregated.py
│   │   └── test_multi_week.py
│   └── api/
│       └── test_generate_workflow.py
│
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
└── README.md
```

### Service Flow

```
POST /generate-workflow
    ↓
1. Parse payload (Pydantic validation)
    ↓
2. Load client config (from CLIENT_ID env var → configs/{client_id}/kpi_config.json)
    ↓
3. Detect edit type:
   - Has all granularity? → SINGLE
   - Missing granularity? → AGGREGATED
    ↓
4. Build WHERE clause from payload filters
    ↓
5. Get edited KPI config
    ↓
6. Get lock strategy (which KPIs to lock)
    ↓
7. Topological sort (calculate dependency order)
    ↓
8. Generate workflow steps:
   │
   ├─ Single edit:
   │  ├─ Step 1: Direct UPDATE for edited KPI
   │  └─ Steps 2+: Recalculate dependent KPIs
   │
   └─ Aggregated edit:
      ├─ Step 1: Calculate current aggregate
      ├─ Step 2: Calculate weights (allocation strategy)
      ├─ Step 3: Calculate deltas
      ├─ Step 4: Apply deltas to edited KPI
      └─ Steps 5+: Recalculate dependent KPIs
    ↓
9. For each dependent KPI:
   │
   ├─ Linear handler?
   │  └─ formula_to_sql(formula, filters) → SQL
   │
   └─ Custom handler?
      └─ get_handler(name)(params, filters) → SQL
    ↓
10. Build workflow JSON with dependencies
    ↓
11. Return workflow JSON
```

---

## 🔑 KEY COMPONENTS

### 1. Workflow Generator

**File:** `app/services/workflow_generator.py`

```python
from typing import Dict, Any, List
from app.models.payload import EditPayload
from app.models.kpi_config import ClientConfig
from app.models.workflow import WorkflowDefinition, WorkflowStep
from app.engine.topological_sort import topological_sort

class WorkflowGenerator:
    def __init__(self, client_config: ClientConfig):
        self.config = client_config
        self.kpi_map = {kpi.name: kpi for kpi in client_config.kpis}

    def generate(self, payload: EditPayload) -> WorkflowDefinition:
        """Main entry point for workflow generation."""

        # Detect edit type
        edit_type = self._detect_edit_type(payload)

        if edit_type == "single":
            return self._generate_single_workflow(payload)
        else:
            return self._generate_aggregated_workflow(payload)

    def _detect_edit_type(self, payload: EditPayload) -> str:
        """Auto-detect single vs aggregated based on granularity."""
        has_all_granularity = all(
            hasattr(payload, col) and getattr(payload, col) is not None
            for col in self.config.granularity
        )
        return "single" if has_all_granularity else "aggregated"

    def _generate_single_workflow(self, payload: EditPayload) -> WorkflowDefinition:
        """
        Generate workflow for single edit.

        Steps:
        1. Direct UPDATE for edited KPI
        2. Topological sort → get dependent KPIs
        3. For each KPI: generate SQL (linear or custom)
        4. Handle multi-week effects
        """
        pass

    def _generate_aggregated_workflow(self, payload: EditPayload) -> WorkflowDefinition:
        """
        Generate workflow for aggregated edit.

        Steps:
        1. Calculate current aggregate
        2. Get allocation strategy from KPI config
        3. Generate weight calculation SQL
        4. Generate delta calculation SQL
        5. Apply deltas
        6. Validate (optional)
        7. Recalculate dependent KPIs
        8. Handle multi-week effects
        """
        pass
```

### 2. Topological Sort

**File:** `app/engine/topological_sort.py`

```python
from typing import Dict, List, Set
from app.models.kpi_config import KPIConfig

def topological_sort(
    kpi_configs: Dict[str, KPIConfig],
    edited_kpi: str,
    locked_kpis: Set[str]
) -> List[List[str]]:
    """
    Kahn's algorithm for dependency ordering.

    Returns levels of KPIs that can be calculated in parallel.

    Example:
        [
            ["AUR", "COGS", "Return U"],  # Level 1 (can run in parallel)
            ["GM $", "Net Sls U"],         # Level 2 (depends on level 1)
            ["GM %", "EOP U"]              # Level 3 (depends on level 2)
        ]
    """

    # 1. Build dependency graph
    graph = {}
    in_degree = {}

    for kpi_name, config in kpi_configs.items():
        if kpi_name == edited_kpi:
            continue
        if kpi_name in locked_kpis:
            continue
        if config.handler_type is None:
            continue

        graph[kpi_name] = set()
        in_degree[kpi_name] = 0

    # 2. Build edges and calculate in-degrees
    for kpi_name in graph.keys():
        config = kpi_configs[kpi_name]
        for dep in config.depends_on:
            if dep in graph:
                graph[dep].add(kpi_name)
                in_degree[kpi_name] += 1

    # 3. Find nodes with in-degree 0
    queue = [kpi for kpi, degree in in_degree.items() if degree == 0]

    # 4. Process level by level (BFS)
    levels = []
    while queue:
        current_level = list(queue)
        queue.clear()

        for node in current_level:
            for dependent in graph[node]:
                in_degree[dependent] -= 1
                if in_degree[dependent] == 0:
                    queue.append(dependent)

        if current_level:
            levels.append(current_level)

    # 5. Check for cycles
    processed = sum(len(level) for level in levels)
    if processed < len(graph):
        raise ValueError("Cycle detected in KPI dependencies!")

    return levels
```

### 3. Formula to SQL Converter

**File:** `app/engine/formula_evaluator.py`

```python
import re
from typing import Dict

def formula_to_sql(
    formula: str,
    kpi_name: str,
    filters: str,
    database: str,
    table: str
) -> str:
    """
    Convert formula string to SQL UPDATE statement.

    Example:
        formula = "Sls $ / Sls U"
        → "ALTER TABLE db.table UPDATE aur = sls_dollars / sls_u WHERE ..."
    """

    # Map KPI names to column names
    def kpi_to_column(kpi: str) -> str:
        return (kpi.lower()
                .replace(' ', '_')
                .replace('%', 'percent')
                .replace('$', 'dollars'))

    # Replace KPI names with column names
    sql_expression = formula
    kpi_pattern = re.compile(r'[A-Z][A-Za-z0-9 %$]*')

    for match in kpi_pattern.finditer(formula):
        kpi = match.group(0).strip()
        column = kpi_to_column(kpi)
        sql_expression = sql_expression.replace(kpi, column)

    # Build UPDATE statement
    target_column = kpi_to_column(kpi_name)

    sql = f"""
    ALTER TABLE {database}.{table}
    UPDATE {target_column} = {sql_expression}
    WHERE {filters}
    """

    return sql.strip()
```

### 4. SQL Expression Generator (Backend)

**File:** `app/services/sql_builder.py`

```python
def generate_time_sql_expression(time_level: str) -> str:
    """
    Generate SQL expression for time aggregation based on level.

    Frontend sends time_level, backend generates SQL.
    """
    expressions = {
        "week": "week",
        "month": "toMonth(toDate(year, 1, 1) + toIntervalWeek(week))",
        "quarter": "toQuarter(toDate(year, 1, 1) + toIntervalWeek(week))",
        "year": "year"
    }

    if time_level not in expressions:
        raise ValueError(f"Unknown time level: {time_level}")

    return expressions[time_level]

def build_where_clause(payload: dict, client_config: dict) -> str:
    """
    Build WHERE clause from payload filters.

    Handles both single and aggregated edits.
    """
    filters = []

    # Granularity filters (for single edits)
    for col in client_config["granularity"]:
        if col in payload and payload[col] is not None:
            filters.append(f"{col} = '{payload[col]}'")

    # Hierarchy filters (for aggregated edits)
    if "dept" in payload:
        filters.append(f"dept = '{payload['dept']}'")
    if "subdept" in payload:
        filters.append(f"subdept = '{payload['subdept']}'")

    # Time filters (for aggregated edits)
    if "time_level" in payload and "time_value" in payload:
        time_sql = generate_time_sql_expression(payload["time_level"])
        filters.append(f"{time_sql} = {payload['time_value']}")

    # Year filter (always present)
    if "year" in payload:
        filters.append(f"year = {payload['year']}")

    return " AND ".join(filters)
```

---

## 📝 IMPLEMENTATION PLAN

### Phase 1: Foundation (Days 1-2)
1. Set up FastAPI project structure
2. Define Pydantic models (EditPayload, KPIConfig, WorkflowDefinition)
3. Create config loader (read JSON, cache in memory)
4. Write unit tests for models

### Phase 2: Core Engine (Days 3-4)
5. Implement topological sort (Kahn's algorithm)
6. Add cycle detection
7. Implement formula-to-SQL converter
8. Write unit tests

### Phase 3: Custom Handlers (Days 5-6)
9. Create handler registry
10. Implement example handlers for Spanx:
    - FWOS handler
    - EOP/BOP handler
    - Return inventory handler
11. Write unit tests for each handler

### Phase 4: Workflow Generator (Days 7-9)
12. Implement single edit workflow generation
13. Implement aggregated edit workflow generation
14. Implement allocation strategy SQL generators
15. Add WHERE clause builder
16. Add time SQL expression generator
17. Write integration tests

### Phase 5: API & Testing (Days 10-11)
18. Add FastAPI endpoint
19. Add error handling and validation
20. End-to-end tests
21. API tests with various payloads

### Phase 6: Documentation (Day 12)
22. API documentation (OpenAPI/Swagger)
23. README with examples
24. Deployment guide

---

## ✅ SUCCESS CRITERIA

- [ ] Single edit generates correct workflow JSON
- [ ] Aggregated edit generates correct workflow JSON
- [ ] Auto-detection works (single vs aggregated)
- [ ] Topological sort handles dependencies correctly
- [ ] Linear formulas convert to SQL correctly
- [ ] Custom handlers generate correct SQL
- [ ] Custom handlers accept params from config
- [ ] Time SQL expressions generated correctly (backend)
- [ ] WHERE clause built correctly from payload
- [ ] Multiple clients supported (separate configs)
- [ ] No cycles in dependency graph
- [ ] 80%+ test coverage

---

## 🚀 GETTING STARTED

```bash
# 1. Create project
mkdir kpi-workflow-generator
cd kpi-workflow-generator

# 2. Set up Python environment
python3.11 -m venv venv
source venv/bin/activate

# 3. Install dependencies
pip install fastapi uvicorn pydantic

# 4. Create structure
mkdir -p app/{models,services,engine/custom_handlers/spanx,allocation}
mkdir -p configs/{spanx,client2,example} tests/{unit,integration,api}

# 5. Create example config for Spanx
cat > configs/spanx/kpi_config.json << 'EOF'
{
  "client_id": "spanx",
  "database": "spanx_kpi_data",
  "data_table": "kpi_data",
  "granularity": ["product_id", "week", "year"],
  "kpis": [...]
}
EOF

# 6. Set environment variable for client
export CLIENT_ID=spanx

# 7. Start building!
```

---

## 🎯 WHAT THIS IS (AND ISN'T)

### ✅ What We're Building

- Workflow generator service
- Config-driven KPI system
- SQL workflow JSON output
- Topological dependency ordering
- Auto-detection (single vs aggregated)
- Client-specific custom handlers
- Allocation strategy SQL generation

### ❌ What We're NOT Building

- Full CRUD API with 20+ endpoints
- Database connection management
- Workflow execution engine
- User authentication
- Direct data manipulation
- Monitoring, caching, rate limiting
- Frontend application

---

## 📚 REFERENCE FILES

Study these TypeScript files from the POC to understand the business logic:

1. **`kpi-poc/src/types.ts`** (157 lines)
   - All type definitions
   - Port to Pydantic models

2. **`kpi-poc/src/engine/KPIEngine.ts`** (350 lines)
   - Main rebalancing algorithm
   - Study the flow, don't port directly (we're generating SQL, not executing)

3. **`kpi-poc/src/engine/topologicalSort.ts`** (161 lines)
   - Kahn's algorithm implementation
   - Port directly to Python

4. **`kpi-poc/src/engine/formulas.ts`** (112 lines)
   - Formula evaluation logic
   - Port the concept (formula → SQL)

5. **`kpi-poc/src/data/kpiConfig.ts`** (270 lines)
   - All 29 KPI definitions
   - Convert to JSON format for configs/

6. **`kpi-poc/src/workflows/workflowGenerator.ts`** (500+ lines)
   - Workflow generation logic
   - Study for SQL generation patterns

---

## 🔍 KEY INSIGHTS

1. **Granularity is storage-level, not edit-level**
   - User edits: (dept, month)
   - Data stored: (product_id, week, year)
   - We distribute from edit → storage

2. **Backend generates SQL, not frontend**
   - Frontend sends: `time_level: "month"`
   - Backend generates: `toMonth(toDate(year, 1, 1) + toIntervalWeek(week))`

3. **One endpoint, auto-detection**
   - Has all granularity columns? → Single
   - Missing granularity? → Aggregated

4. **Client-specific everything (environment-isolated)**
   - Separate config directories per client (`configs/spanx/`, `configs/client2/`)
   - Separate handler directories per client (`custom_handlers/spanx/`)
   - Client loaded from `CLIENT_ID` environment variable
   - One codebase serves all clients with complete isolation

5. **We generate workflows, don't execute them**
   - Output: JSON with SQL steps
   - External system executes (Airflow, Dagster, etc.)

---

Keep it focused on workflow generation! 🎯
