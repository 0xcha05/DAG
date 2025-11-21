# KPI Workflow Generator - FastAPI Service

## 🎯 MISSION

Build a **Python FastAPI service** that generates SQL workflow JSON from client-specific KPI configurations. When the frontend sends a KPI edit (single or aggregated), this service reads the client's config and generates a complete workflow with SQL steps.

**Reference Codebase:** `/home/user/DAG/kpi-poc/` (TypeScript/React POC - approved)

---

## 📋 WHAT THIS SERVICE DOES

### NOT Building
❌ Full CRUD API with 20+ endpoints
❌ Database management endpoints
❌ User authentication
❌ Direct data manipulation

### Actually Building
✅ **Workflow generator** that takes edit payload + config → returns workflow JSON
✅ **Client-specific KPI configs** (spanx.json, client2.json, etc.)
✅ **Two handler types:**
   - Linear cases (formula-based KPIs)
   - Custom handlers (Python functions for complex logic)
✅ **Topological sort** for dependency ordering
✅ **Allocation strategies** for aggregated edits

---

## 🏗️ HIGH-LEVEL ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React)                         │
│                                                              │
│  User edits KPI → Sends payload to backend                 │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│               FastAPI Workflow Generator                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Receive edit payload (single or aggregated)             │
│  2. Load client's KPI config (spanx.json)                   │
│  3. Topological sort → determine calculation order          │
│  4. For each affected KPI:                                  │
│     - If linear: Generate SQL from formula                  │
│     - If custom handler: Call Python function → get SQL     │
│  5. Return workflow JSON with all SQL steps                 │
│                                                              │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  Workflow JSON Output                        │
│                                                              │
│  {                                                           │
│    "workflow_id": "...",                                     │
│    "steps": [                                                │
│      { "step_id": "...", "sql": "...", ... },               │
│      { "step_id": "...", "sql": "...", ... }                │
│    ]                                                         │
│  }                                                           │
└─────────────────────────────────────────────────────────────┘
```

**External system** (Airflow, Dagster, etc.) executes the workflow JSON.

---

## 📥 INPUT: FRONTEND PAYLOADS

### Payload 1: Single KPI Edit

**Use case:** User edits one product, one week, one KPI.

```json
{
  "client_id": "spanx",
  "edit_type": "single",
  "product_id": "PROD-001",
  "week": 10,
  "year": 2024,
  "kpi": "Sls U",
  "new_value": 150
}
```

### Payload 2: Aggregated KPI Edit

**Use case:** User edits at department-month level, needs distribution.

```json
{
  "client_id": "spanx",
  "edit_type": "aggregated",
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

---

## 📤 OUTPUT: WORKFLOW JSON

### Structure

```json
{
  "workflow_id": "spanx_edit_Sls_U_1234567890",
  "client_id": "spanx",
  "description": "Edit Sls U at dept-month level",
  "steps": [
    {
      "step_id": "step_1_calculate_current_aggregate",
      "description": "Calculate current aggregate value",
      "sql": "SELECT dept, SUM(sls_u) as current_value FROM kpi_data WHERE dept = 'Electronics' AND ... GROUP BY dept",
      "dependencies": [],
      "cleanup": false
    },
    {
      "step_id": "step_2_calculate_weights",
      "description": "Calculate allocation weights using pro_rata",
      "sql": "WITH granular AS (...) SELECT product_id, week, year, weight FROM ...",
      "dependencies": ["step_1_calculate_current_aggregate"],
      "cleanup": false
    },
    {
      "step_id": "step_3_apply_edit_sls_u",
      "description": "Apply delta to Sls U",
      "sql": "ALTER TABLE kpi_data UPDATE sls_u = sls_u + delta WHERE ...",
      "dependencies": ["step_2_calculate_weights"],
      "cleanup": false
    },
    {
      "step_id": "step_4_recalc_cogs",
      "description": "Recalculate COGS (linear)",
      "sql": "ALTER TABLE kpi_data UPDATE cogs = sls_u * auc WHERE ...",
      "dependencies": ["step_3_apply_edit_sls_u"],
      "cleanup": false
    },
    {
      "step_id": "step_5_recalc_eop_u",
      "description": "Recalculate EOP U (custom handler)",
      "sql": "ALTER TABLE kpi_data UPDATE eop_u = bop_u - sls_u + total_rcpt_u + return_inv WHERE ...",
      "dependencies": ["step_3_apply_edit_sls_u"],
      "cleanup": false
    }
  ],
  "metadata": {
    "execution_mode": "clickhouse",
    "max_parallel_steps": 4,
    "timeout_seconds": 300
  }
}
```

---

## 🗂️ KPI CONFIG STRUCTURE

### Config File: `configs/spanx.json`

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
      "custom_handler": "eop_bop_handler",
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
      "custom_handler": "forward_weeks_of_supply_handler",
      "handler_params": {
        "number_of_weeks": 6
      },
      "depends_on": ["EOP U", "Sls U"],
      "locks_when_edited": []
    }
  ]
}
```

### Key Fields

| Field | Description |
|-------|-------------|
| `handler_type` | "linear" (formula-based) or "custom" (Python function) |
| `formula` | For linear: SQL expression like "Sls U * AUC" |
| `custom_handler` | For custom: Python function name like "eop_bop_handler" |
| `handler_params` | For custom: Static params passed to function |
| `depends_on` | KPIs this depends on (for topological sort) |
| `locks_when_edited` | KPIs to lock when this is edited |
| `allocation_strategy` | How to distribute aggregated edits |

---

## 🔧 CUSTOM HANDLERS

### Handler Interface

```python
from typing import Dict, Any

def custom_handler_interface(
    kpi_name: str,
    kpi_config: Dict[str, Any],
    handler_params: Dict[str, Any],
    filters: str,  # WHERE clause from edit payload
    granularity: List[str],
    database: str,
    table: str
) -> str:
    """
    Returns SQL query for this KPI.

    Args:
        kpi_name: "EOP U", "FWOS", etc.
        kpi_config: Full KPI config dict
        handler_params: Static params from config
        filters: WHERE clause (e.g., "product_id = 'PROD-001' AND week = 10")
        granularity: ["product_id", "week", "year"]
        database: "spanx_kpi_data"
        table: "kpi_data"

    Returns:
        SQL ALTER TABLE UPDATE statement
    """
    pass
```

### Example 1: EOP → BOP Handler

```python
def eop_bop_handler(
    kpi_name: str,
    kpi_config: Dict[str, Any],
    handler_params: Dict[str, Any],
    filters: str,
    granularity: List[str],
    database: str,
    table: str
) -> str:
    """
    EOP U (Week N) → BOP U (Week N+1)

    Formula: EOP U = BOP U - Sls U + Total Rcpt U + Return Inv
    """

    if kpi_name == "EOP U":
        sql = f"""
        ALTER TABLE {database}.{table}
        UPDATE eop_u = bop_u - sls_u + total_rcpt_u + return_inv
        WHERE {filters}
        """
        return sql.strip()

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
        WHERE target.week > (SELECT MIN(week) FROM {database}.{table} WHERE {filters})
          AND {filters}
        """
        return sql.strip()
```

### Example 2: FWOS Handler

```python
def forward_weeks_of_supply_handler(
    kpi_name: str,
    kpi_config: Dict[str, Any],
    handler_params: Dict[str, Any],
    filters: str,
    granularity: List[str],
    database: str,
    table: str
) -> str:
    """
    FWOS = EOP U / (average Sls U over next N weeks)
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

### Example 3: Return Inventory Handler (4-week delay)

```python
def return_inventory_handler(
    kpi_name: str,
    kpi_config: Dict[str, Any],
    handler_params: Dict[str, Any],
    filters: str,
    granularity: List[str],
    database: str,
    table: str
) -> str:
    """
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

---

## 🏗️ CORE ARCHITECTURE

### Service Flow

```
1. POST /generate-workflow
   ↓
2. Load client config (configs/spanx.json)
   ↓
3. Parse edit payload (single or aggregated)
   ↓
4. Get edited KPI config
   ↓
5. Get lock strategy
   ↓
6. Topological sort → calculation order
   ↓
7. For each affected KPI:
   ├─ If linear: Generate SQL from formula
   └─ If custom: Call handler function → get SQL
   ↓
8. Build workflow JSON with all steps
   ↓
9. Return workflow JSON
```

### Directory Structure

```
kpi-workflow-generator/
├── app/
│   ├── main.py                      # FastAPI app
│   ├── config.py                    # Settings
│   │
│   ├── models/
│   │   ├── edit_payload.py          # SingleEdit, AggregatedEdit
│   │   ├── kpi_config.py            # KPIConfig, ClientConfig
│   │   ├── workflow.py              # WorkflowDefinition, WorkflowStep
│   │   └── aggregation.py           # AggregationContext
│   │
│   ├── services/
│   │   ├── workflow_generator.py    # Main workflow builder
│   │   ├── config_loader.py         # Load client configs
│   │   └── sql_builder.py           # SQL generation utilities
│   │
│   ├── engine/
│   │   ├── topological_sort.py      # Kahn's algorithm
│   │   ├── formula_evaluator.py     # Convert formulas to SQL
│   │   └── custom_handlers/
│   │       ├── __init__.py
│   │       ├── eop_bop.py           # EOP/BOP handler
│   │       ├── fwos.py              # FWOS handler
│   │       ├── return_inventory.py  # Return inv handler
│   │       └── registry.py          # Handler registry
│   │
│   └── allocation/
│       ├── pro_rata.py              # Pro-rata SQL generator
│       ├── equal.py                 # Equal SQL generator
│       ├── historical.py            # Historical SQL generator
│       └── weighted.py              # Weighted SQL generator
│
├── configs/                         # Client KPI configs
│   ├── spanx.json
│   ├── client2.json
│   └── example.json
│
├── tests/
│   ├── test_topological_sort.py
│   ├── test_workflow_single.py
│   ├── test_workflow_aggregated.py
│   └── test_custom_handlers.py
│
├── requirements.txt
├── Dockerfile
└── README.md
```

---

## 🔑 KEY COMPONENTS

### 1. Workflow Generator Service

**File:** `app/services/workflow_generator.py`

```python
from typing import Dict, Any, List
from app.models.edit_payload import SingleEdit, AggregatedEdit
from app.models.kpi_config import ClientConfig
from app.models.workflow import WorkflowDefinition, WorkflowStep
from app.engine.topological_sort import topological_sort

class WorkflowGenerator:
    def __init__(self, client_config: ClientConfig):
        self.config = client_config
        self.kpi_map = {kpi.name: kpi for kpi in client_config.kpis}

    def generate(self, payload: SingleEdit | AggregatedEdit) -> WorkflowDefinition:
        """Main entry point for workflow generation."""

        if isinstance(payload, SingleEdit):
            return self._generate_single_edit_workflow(payload)
        else:
            return self._generate_aggregated_edit_workflow(payload)

    def _generate_single_edit_workflow(self, payload: SingleEdit) -> WorkflowDefinition:
        """
        Generate workflow for single product-week edit.

        Steps:
        1. Apply direct edit (UPDATE kpi_data SET kpi = value WHERE ...)
        2. Get affected KPIs (topological sort)
        3. For each KPI: generate SQL (linear or custom)
        4. Handle multi-week effects (EOP→BOP, returns)
        """
        pass

    def _generate_aggregated_edit_workflow(self, payload: AggregatedEdit) -> WorkflowDefinition:
        """
        Generate workflow for aggregated edit with allocation.

        Steps:
        1. Calculate current aggregate
        2. Calculate weights (using allocation strategy)
        3. Calculate deltas
        4. Apply deltas
        5. Validate (optional)
        6. Recalculate dependent KPIs
        7. Handle multi-week effects
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
            ["AUR", "COGS", "Return U"],  # Level 1
            ["GM $", "Net Sls U"],         # Level 2
            ["GM %", "EOP U"]              # Level 3
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
        →
        "ALTER TABLE db.table UPDATE aur = sls_dollars / sls_u WHERE ..."
    """

    # Map KPI names to column names (spaces → underscores, lowercase)
    def kpi_to_column(kpi: str) -> str:
        return kpi.lower().replace(' ', '_').replace('%', 'percent').replace('$', 'dollars')

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

### 4. Custom Handler Registry

**File:** `app/engine/custom_handlers/registry.py`

```python
from typing import Dict, Callable
from app.engine.custom_handlers.eop_bop import eop_bop_handler
from app.engine.custom_handlers.fwos import forward_weeks_of_supply_handler
from app.engine.custom_handlers.return_inventory import return_inventory_handler

# Handler type signature
HandlerFunction = Callable[[str, Dict, Dict, str, list, str, str], str]

# Registry of all custom handlers
CUSTOM_HANDLERS: Dict[str, HandlerFunction] = {
    "eop_bop_handler": eop_bop_handler,
    "forward_weeks_of_supply_handler": forward_weeks_of_supply_handler,
    "return_inventory_handler": return_inventory_handler,
}

def get_handler(handler_name: str) -> HandlerFunction:
    """Get custom handler by name."""
    if handler_name not in CUSTOM_HANDLERS:
        raise ValueError(f"Unknown custom handler: {handler_name}")
    return CUSTOM_HANDLERS[handler_name]
```

### 5. Allocation Strategy

**File:** `app/allocation/pro_rata.py`

```python
def generate_pro_rata_sql(
    kpi_column: str,
    aggregation_context: Dict,
    database: str,
    table: str
) -> str:
    """
    Generate SQL for pro-rata allocation.

    Weight = current_value / SUM(current_value)
    """

    where = aggregation_context["where"]
    granularity = aggregation_context["granularity"]
    granularity_cols = ", ".join(granularity)

    sql = f"""
    WITH granular_values AS (
        SELECT
            {granularity_cols},
            {kpi_column} as current_value
        FROM {database}.{table}
        WHERE {where}
    ),
    totals AS (
        SELECT SUM(current_value) as total_value
        FROM granular_values
    )
    SELECT
        g.{granularity_cols.replace(', ', ', g.')},
        g.current_value / t.total_value as weight
    FROM granular_values g
    CROSS JOIN totals t
    """

    return sql.strip()
```

---

## 🔌 API ENDPOINT (Just One!)

### POST `/generate-workflow`

**Request:**
```json
{
  "client_id": "spanx",
  "edit_type": "single",
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
      "description": "Recalculate COGS",
      "sql": "ALTER TABLE spanx_kpi_data.kpi_data UPDATE cogs = sls_u * auc WHERE product_id = 'PROD-001' AND week = 10 AND year = 2024",
      "dependencies": ["step_1_apply_edit"],
      "cleanup": false
    },
    {
      "step_id": "step_3_recalc_eop_u",
      "description": "Recalculate EOP U",
      "sql": "ALTER TABLE spanx_kpi_data.kpi_data UPDATE eop_u = bop_u - sls_u + total_rcpt_u + return_inv WHERE product_id = 'PROD-001' AND week = 10 AND year = 2024",
      "dependencies": ["step_1_apply_edit"],
      "cleanup": false
    }
  ],
  "metadata": {
    "execution_mode": "clickhouse",
    "max_parallel_steps": 4,
    "timeout_seconds": 300
  }
}
```

---

## 📝 IMPLEMENTATION PLAN

### Phase 1: Foundation (Day 1)
1. Set up FastAPI project
2. Define Pydantic models (EditPayload, KPIConfig, WorkflowDefinition)
3. Create config loader (read JSON files)

### Phase 2: Topological Sort (Day 2)
4. Implement Kahn's algorithm
5. Add cycle detection
6. Write unit tests

### Phase 3: Linear Cases (Day 3)
7. Implement formula-to-SQL converter
8. Test with simple formulas (AUR, COGS, GM$)

### Phase 4: Custom Handlers (Day 4-5)
9. Create handler registry
10. Implement EOP/BOP handler
11. Implement FWOS handler
12. Implement return inventory handler
13. Test each handler

### Phase 5: Workflow Generator (Day 6-7)
14. Implement single edit workflow generation
15. Implement aggregated edit workflow generation
16. Add allocation strategy SQL generation
17. Integration tests

### Phase 6: API & Testing (Day 8)
18. Add FastAPI endpoint
19. End-to-end tests
20. Documentation

---

## ✅ SUCCESS CRITERIA

- [ ] Single edit generates correct workflow JSON
- [ ] Aggregated edit generates correct workflow JSON with allocation
- [ ] Topological sort handles dependencies correctly
- [ ] Linear formulas convert to SQL correctly
- [ ] Custom handlers generate correct SQL
- [ ] Custom handlers accept parameters from config
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
mkdir -p app/{models,services,engine/custom_handlers,allocation}
mkdir -p configs tests

# 5. Create first config
cat > configs/spanx.json << 'EOF'
{
  "client_id": "spanx",
  "database": "spanx_kpi_data",
  "data_table": "kpi_data",
  "granularity": ["product_id", "week", "year"],
  "kpis": [...]
}
EOF

# 6. Start building!
```

---

## 🎯 FOCUS AREAS

**This is NOT about:**
- Building a full CRUD API
- Managing database connections
- User authentication
- Direct data manipulation

**This IS about:**
- Reading edit payloads
- Reading client configs
- Generating workflow JSON
- Converting formulas to SQL
- Calling custom handler functions
- Topological dependency ordering

Keep it focused! 🎯
