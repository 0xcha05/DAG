# Workflow Generator: Date Range Resolution

## The Problem

The payload contains **time period identifiers**, not actual dates:

```json
{
  "kpi": "written_sales_dollars",
  "new_value": 50000,
  "time_level": "month",
  "time_value": 1,
  "year": 2024
}
```

But the generated SQL needs **actual date literals**:

```sql
toDate(year, 1, 1) + toIntervalWeek(week - 1) >= toDate('2024-01-01')
AND toDate(year, 1, 1) + toIntervalWeek(week - 1) <= toDate('2024-01-31')
```

## The Workflow Generator's Job

The workflow generator must:
1. Parse `time_level`, `time_value`, `year` from payload
2. Calculate `start_date` and `end_date`
3. Generate SQL with those calculated dates

## Date Calculation Logic

### Month
**Input:** `time_level: "month"`, `time_value: 1`, `year: 2024`

**Calculation:**
```python
from datetime import date
from calendar import monthrange

def resolve_month_dates(month: int, year: int) -> tuple[str, str]:
    """
    Convert month number to date range.

    Args:
        month: 1-12
        year: 2024, etc.

    Returns:
        (start_date, end_date) as ISO strings
    """
    start_date = date(year, month, 1)
    last_day = monthrange(year, month)[1]
    end_date = date(year, month, last_day)

    return start_date.isoformat(), end_date.isoformat()

# Example
start, end = resolve_month_dates(1, 2024)
# Returns: ('2024-01-01', '2024-01-31')
```

### Quarter
**Input:** `time_level: "quarter"`, `time_value: 1`, `year: 2024`

**Calculation:**
```python
def resolve_quarter_dates(quarter: int, year: int) -> tuple[str, str]:
    """
    Convert quarter number to date range.

    Args:
        quarter: 1-4
        year: 2024, etc.

    Returns:
        (start_date, end_date) as ISO strings
    """
    quarter_start_months = {
        1: (1, 3),   # Q1: Jan-Mar
        2: (4, 6),   # Q2: Apr-Jun
        3: (7, 9),   # Q3: Jul-Sep
        4: (10, 12)  # Q4: Oct-Dec
    }

    start_month, end_month = quarter_start_months[quarter]

    start_date = date(year, start_month, 1)
    last_day = monthrange(year, end_month)[1]
    end_date = date(year, end_month, last_day)

    return start_date.isoformat(), end_date.isoformat()

# Example
start, end = resolve_quarter_dates(1, 2024)
# Returns: ('2024-01-01', '2024-03-31')
```

### Year
**Input:** `time_level: "year"`, `year: 2024`

**Calculation:**
```python
def resolve_year_dates(year: int) -> tuple[str, str]:
    """
    Convert year to date range.

    Args:
        year: 2024, etc.

    Returns:
        (start_date, end_date) as ISO strings
    """
    start_date = date(year, 1, 1)
    end_date = date(year, 12, 31)

    return start_date.isoformat(), end_date.isoformat()

# Example
start, end = resolve_year_dates(2024)
# Returns: ('2024-01-01', '2024-12-31')
```

### Week
**Input:** `time_level: "week"`, `time_value: 10`, `year: 2024`

**Calculation:**
```python
from datetime import timedelta

def resolve_week_dates(week: int, year: int) -> tuple[str, str]:
    """
    Convert week number to date range.

    Assumes week 1 = first 7 days of year.

    Args:
        week: 1-52
        year: 2024, etc.

    Returns:
        (start_date, end_date) as ISO strings
    """
    year_start = date(year, 1, 1)

    # Week N starts on day (N-1)*7
    start_date = year_start + timedelta(days=(week - 1) * 7)
    end_date = start_date + timedelta(days=6)

    return start_date.isoformat(), end_date.isoformat()

# Example
start, end = resolve_week_dates(10, 2024)
# Returns: ('2024-03-04', '2024-03-10')
```

**Note:** Week calculation may vary by client (ISO week, calendar week, etc.). This is a simple example.

## Workflow Generator Function

```python
def calculate_date_range(payload: dict) -> tuple[str, str]:
    """
    Calculate start and end dates from payload time fields.

    Args:
        payload: Request payload with time_level, time_value, year

    Returns:
        (start_date, end_date) as ISO strings

    Raises:
        ValueError: If time_level is invalid
    """
    time_level = payload.get("time_level")
    time_value = payload.get("time_value")
    year = payload["year"]

    if time_level == "month":
        return resolve_month_dates(time_value, year)
    elif time_level == "quarter":
        return resolve_quarter_dates(time_value, year)
    elif time_level == "year":
        return resolve_year_dates(year)
    elif time_level == "week":
        return resolve_week_dates(time_value, year)
    else:
        raise ValueError(f"Invalid time_level: {time_level}")
```

## SQL Generation Example

```python
def generate_allocate_step(payload: dict, config: dict) -> dict:
    """
    Generate allocation step with fully hydrated SQL.
    """
    # 1. Calculate date range from payload
    start_date, end_date = calculate_date_range(payload)

    # 2. Extract other payload fields
    kpi_column = "written_sales_dollars"
    new_value = payload["new_value"]

    # 3. Generate SQL with actual dates
    sql = f"""
    CREATE TEMPORARY TABLE allocated_written_sls_temp ENGINE = Memory AS
    SELECT
      product_id, week, year, l0_name, l1_name, l2_name, channel,
      multiIf(
        toDate(year, 1, 1) + toIntervalWeek(week - 1) >= toDate('{start_date}')
        AND toDate(year, 1, 1) + toIntervalWeek(week - 1) <= toDate('{end_date}'),
        {new_value} * ({kpi_column} / SUM({kpi_column}) OVER ()),
        {kpi_column}
      ) AS {kpi_column},
      ...
    FROM kpi_edit_base_temp_table
    """

    return {
        "step_id": "allocate_written_sales_dollars",
        "source_table": "kpi_edit_base_temp_table",
        "target_table": "allocated_written_sls_temp",
        "process_sql": sql.strip(),
        "cleanup_source": false,
        "dependencies": []
    }
```

## Complete Flow

```
Payload:
{
  "time_level": "month",
  "time_value": 1,
  "year": 2024
}
         ↓
calculate_date_range()
         ↓
start_date = '2024-01-01'
end_date = '2024-01-31'
         ↓
generate_sql()
         ↓
SQL:
toDate(year, 1, 1) + toIntervalWeek(week - 1) >= toDate('2024-01-01')
AND toDate(year, 1, 1) + toIntervalWeek(week - 1) <= toDate('2024-01-31')
```

## Why This Approach?

### ✅ Advantages
1. **Orchestrator simplicity** - Just executes SQL, no date logic
2. **SQL is self-contained** - Can copy/paste for debugging
3. **Testable** - Easy to verify date calculations
4. **Auditable** - Workflow JSON shows exact dates used

### ❌ Alternative (Bad)
Don't do this:
```python
# BAD: Let orchestrator figure out dates
sql = """
WHERE week BETWEEN get_start_week({time_level}, {time_value})
  AND get_end_week({time_level}, {time_value})
"""
```

This pushes complexity to orchestrator and makes SQL non-portable.

## Edge Cases

### Leap Years
```python
# February 2024 (leap year)
resolve_month_dates(2, 2024)
# Returns: ('2024-02-01', '2024-02-29')

# February 2023 (non-leap year)
resolve_month_dates(2, 2023)
# Returns: ('2023-02-01', '2023-02-28')
```

### Week 53
Some years have 53 weeks. Handle gracefully:
```python
def resolve_week_dates(week: int, year: int) -> tuple[str, str]:
    if week > 52:
        raise ValueError(f"Week {week} is out of range for year {year}")
    # ... rest of logic
```

### Client-Specific Week Definitions
Some clients may use ISO weeks, fiscal weeks, etc. This should be configurable:
```json
{
  "client_id": "spanx",
  "week_definition": "calendar",  // or "iso", "fiscal"
  ...
}
```

## Summary

**Input (from payload):**
- `time_level`: "month", "quarter", "year", "week"
- `time_value`: 1-12 (month), 1-4 (quarter), 1-52 (week)
- `year`: 2024

**Workflow Generator Calculates:**
- `start_date`: '2024-01-01'
- `end_date`: '2024-01-31'

**Output (in workflow JSON):**
- Fully hydrated SQL with literal dates
- No placeholders or runtime calculations
