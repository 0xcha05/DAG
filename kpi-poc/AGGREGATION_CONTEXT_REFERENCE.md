# Aggregation Context Reference Guide

## Quick Overview

**AggregationContext** describes WHERE the user is editing. It has 4 parts:

```
┌─────────────────────────────────────────┐
│        AggregationContext               │
├─────────────────────────────────────────┤
│ 1. time?        (TimeAggregation)       │ ← Optional: Time dimension
│ 2. hierarchy?   (HierarchyAggregation)  │ ← Optional: Hierarchy dimension
│ 3. where        (string)                │ ← Required: Filter
│ 4. granularity  (string[])              │ ← Required: Target level
└─────────────────────────────────────────┘
```

---

## 1. Time Aggregation (Optional)

**When to use:** User is editing at a time level (year, quarter, month)

```typescript
interface TimeAggregation {
  level: 'year' | 'quarter' | 'month' | 'week';  // Edit level
  sqlExpression: string;                          // How to map weeks → level
}
```

### Examples

| Edit Level | sqlExpression | Description |
|-----------|---------------|-------------|
| `year` | `'year'` | Simple - just use year column |
| `quarter` | `'toQuarter(toDate(year, 1, 1) + toIntervalWeek(week))'` | Convert week → quarter |
| `month` | `'toMonth(toDate(year, 1, 1) + toIntervalWeek(week))'` | Convert week → month |
| `week` | `'week'` | No conversion needed |

### Usage

```typescript
// User edits: "January 2024, Sls U = 50,000"
const time: TimeAggregation = {
  level: 'month',
  sqlExpression: 'toMonth(toDate(year, 1, 1) + toIntervalWeek(week))'
};

// This tells the system:
// - User is editing at MONTH level
// - Use this SQL to group weeks into months
// - Will distribute across all weeks in January
```

---

## 2. Hierarchy Aggregation (Optional)

**When to use:** User is editing at a hierarchy level (dept, subdept, category)

```typescript
interface HierarchyAggregation {
  level: string;      // Edit level (e.g., 'dept', 'subdept')
  levels: string[];   // All hierarchy columns at this level
}
```

### Examples

| Edit Level | levels | Description |
|-----------|--------|-------------|
| `dept` | `['dept']` | Editing at department level |
| `subdept` | `['dept', 'subdept']` | Editing at sub-department level (includes parent) |
| `category` | `['dept', 'subdept', 'category']` | Editing at category level (includes all parents) |

### Usage

```typescript
// User edits: "Electronics department, Sls U = 500,000"
const hierarchy: HierarchyAggregation = {
  level: 'dept',
  levels: ['dept']
};

// This tells the system:
// - User is editing at DEPT level
// - Include 'dept' column in grouping
// - Will distribute across all products in Electronics
```

### Multi-Level Example

```typescript
// User edits: "Electronics → Televisions, Sls U = 120,000"
const hierarchy: HierarchyAggregation = {
  level: 'subdept',
  levels: ['dept', 'subdept']  // Include parent dept + current level
};

// This tells the system:
// - User is editing at SUBDEPT level
// - Group by BOTH dept AND subdept
// - Will distribute across TV products only
```

---

## 3. Where Clause (Required)

**Purpose:** Filter which records to include in the edit

```typescript
where: string;  // SQL WHERE clause
```

### Examples

```typescript
// Time only
where: "year = 2024"

// Hierarchy only
where: "dept = 'Electronics'"

// Time + Hierarchy
where: "dept = 'Electronics' AND year = 2024"

// Time + Hierarchy (complex)
where: "dept = 'Electronics' AND toMonth(toDate(year, 1, 1) + toIntervalWeek(week)) = 1 AND year = 2024"
```

### Rules

- ✅ Must match the time/hierarchy levels specified
- ✅ Can include additional filters (channel, region, etc.)
- ✅ Should use the same `sqlExpression` from TimeAggregation

---

## 4. Granularity (Required)

**Purpose:** Target columns for distribution (storage level)

```typescript
granularity: string[];  // Column names at storage level
```

### Examples

```typescript
// Simple: Product + Week + Year
granularity: ['product_id', 'week', 'year']

// With SKU instead of product_id
granularity: ['sku', 'week_start_date', 'fiscal_year']

// With additional dimensions
granularity: ['product_id', 'week', 'year', 'channel', 'region']
```

### How It's Used

```sql
-- In weight calculation:
SELECT
  product_id, week, year,  -- ← From granularity
  weight
FROM ...

-- In delta application:
ALTER TABLE kpi_data
UPDATE sls_u = sls_u + delta
WHERE (product_id, week, year) IN (...)  -- ← From granularity
```

---

## Complete Example

### Scenario
**User edits:** "Electronics department, January 2024, Sls U = 50,000"

### Breaking It Down

```typescript
// 1. TIME AGGREGATION
const time: TimeAggregation = {
  level: 'month',  // ← User editing at MONTH level
  sqlExpression: 'toMonth(toDate(year, 1, 1) + toIntervalWeek(week))'  // ← Map weeks → month
};
// Meaning: "I'm editing all of January (which contains weeks 1-4)"

// 2. HIERARCHY AGGREGATION
const hierarchy: HierarchyAggregation = {
  level: 'dept',    // ← User editing at DEPT level
  levels: ['dept']  // ← Only dept column (no subdept, category)
};
// Meaning: "I'm editing all of Electronics (all products in that dept)"

// 3. WHERE CLAUSE
const where = "dept = 'Electronics' AND toMonth(toDate(year, 1, 1) + toIntervalWeek(week)) = 1 AND year = 2024";
// Meaning: "Include only Electronics products, January weeks, 2024"

// 4. GRANULARITY
const granularity = ['product_id', 'week', 'year'];
// Meaning: "Distribute to each product-week combination"

// COMBINE
const aggregationContext: AggregationContext = {
  time,
  hierarchy,
  where,
  granularity
};
```

### What Happens

```
┌─────────────────────────────────────────────────────────┐
│ User Input                                              │
│ "Electronics, January 2024, Sls U = 50,000"            │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ AggregationContext                                      │
│                                                         │
│ TIME:      Month level → weeks 1-4 in Jan 2024        │
│ HIERARCHY: Dept level → all Electronics products       │
│ WHERE:     dept='Electronics' AND month=1 AND year=2024│
│ TARGET:    product_id + week + year                    │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ SQL Generation                                          │
│                                                         │
│ 1. Calculate current: SUM(sls_u) WHERE ...             │
│    Result: 48,000                                      │
│                                                         │
│ 2. Calculate weights: product-week proportions         │
│    P001/W1: 0.208%, P001/W2: 0.312%, ...               │
│                                                         │
│ 3. Distribute delta: (50,000 - 48,000) * weight        │
│    P001/W1: +4.16, P001/W2: +6.24, ...                 │
│                                                         │
│ 4. Apply to granularity: product_id + week + year      │
└─────────────────────────────────────────────────────────┘
```

---

## Common Patterns

### Pattern 1: Time Only (No Hierarchy Filter)

```typescript
// "Edit all products for 2024, Sls U = 500,000"
{
  time: {
    level: 'year',
    sqlExpression: 'year'
  },
  hierarchy: undefined,  // ← No hierarchy filter!
  where: "year = 2024",
  granularity: ['product_id', 'week', 'year']
}
```

### Pattern 2: Hierarchy Only (No Time Filter)

```typescript
// "Edit Electronics for all time, Sls U = 500,000"
{
  time: undefined,  // ← No time filter!
  hierarchy: {
    level: 'dept',
    levels: ['dept']
  },
  where: "dept = 'Electronics'",
  granularity: ['product_id', 'week', 'year']
}
```

### Pattern 3: Multi-Dimensional

```typescript
// "Edit Electronics + Online channel, Q1 2024, Sls U = 120,000"
{
  time: {
    level: 'quarter',
    sqlExpression: 'toQuarter(toDate(year, 1, 1) + toIntervalWeek(week))'
  },
  hierarchy: {
    level: 'dept_channel',
    levels: ['dept', 'channel']  // ← Multiple hierarchy dimensions!
  },
  where: "dept = 'Electronics' AND channel = 'Online' AND toQuarter(...) = 1 AND year = 2024",
  granularity: ['product_id', 'week', 'year']
}
```

---

## Troubleshooting

### Issue: "No records found to distribute"

**Check:**
- Does `where` clause match actual data?
- Does `time.sqlExpression` correctly map to records?
- Are hierarchy `levels` columns present in the table?

### Issue: "Distributed sum doesn't match edited value"

**Check:**
- Is `where` clause too restrictive/broad?
- Does `time.sqlExpression` include all intended weeks?
- Validation tolerance may need adjustment

### Issue: "Strategy not found for aggregation level"

**Check:**
- KPI config has strategy for this `time.level` or `hierarchy.level`?
- Is there a `default` strategy defined?

---

## See Also

- [WORKFLOW_ALLOCATION_GUIDE.md](./WORKFLOW_ALLOCATION_GUIDE.md) - Complete allocation documentation
- [/workflows/examples.ts](./src/workflows/examples.ts) - Working examples
- [/workflows/types.ts](./src/workflows/types.ts) - Type definitions
