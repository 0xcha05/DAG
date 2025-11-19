/**
 * Workflow Generation Examples (Version 2)
 *
 * Demonstrates KPI-specific allocation strategies.
 * The allocation strategy comes from the KPI config, not from the workflow context.
 */

import type {
  WorkflowContext,
  AggregationContext,
  TimeAggregation,
  HierarchyAggregation,
} from './types';
import {
  generateAggregatedEditWorkflow,
  generateSingleProductEditWorkflow,
} from './workflowGenerator';

/**
 * ANATOMY OF AN AGGREGATION CONTEXT
 *
 * Breaking down each component:
 *
 * 1. TIME AGGREGATION (optional)
 *    - level: What time level is the user editing at? (year, quarter, month, week)
 *    - sqlExpression: SQL to map storage level (weeks) to edit level
 *
 * 2. HIERARCHY AGGREGATION (optional)
 *    - level: What hierarchy level is the user editing at? (dept, subdept, category, etc.)
 *    - levels: All hierarchy columns at this level
 *
 * 3. WHERE (required)
 *    - Filter clause to identify which records to include
 *
 * 4. GRANULARITY (required)
 *    - Target columns for distribution (storage level)
 *
 * Example breakdown:
 *
 * User action: "Edit Electronics department, January 2024, Sls U = 50,000"
 *
 * TIME:
 *   - User is editing at MONTH level (January)
 *   - Storage has WEEK level (weeks 1-52)
 *   - sqlExpression maps weeks → month
 *
 * HIERARCHY:
 *   - User is editing at DEPT level (Electronics)
 *   - Storage has PRODUCT level (P001, P002, ...)
 *   - levels: ['dept'] (all hierarchy columns at this level)
 *
 * WHERE:
 *   - "dept = 'Electronics' AND month = 1 AND year = 2024"
 *   - Filters to: Electronics products, January weeks, 2024
 *
 * GRANULARITY:
 *   - ['product_id', 'week', 'year']
 *   - Distribute to each product-week combination
 */

/**
 * Example 1: Department-level Sls U edit (year aggregation)
 *
 * Sls U config has:
 * - default: pro_rata
 * - time.year: historical (lookback 2 years)
 *
 * Since this is a year-level edit, it will use the historical strategy.
 */
export function example1_slsU_yearLevel() {
  // Define TIME aggregation
  const timeAggregation: TimeAggregation = {
    level: 'year',           // User editing at YEAR level
    sqlExpression: 'year',   // Map weeks → year (simple: just use year column)
  };

  // Define HIERARCHY aggregation
  const hierarchyAggregation: HierarchyAggregation = {
    level: 'dept',    // User editing at DEPT level
    levels: ['dept'], // Only 1 hierarchy column at this level
  };

  // Combine into aggregation context
  const aggregationContext: AggregationContext = {
    time: timeAggregation,
    hierarchy: hierarchyAggregation,
    where: "dept = 'Electronics' AND year = 2024",  // Filter: Electronics + 2024
    granularity: ['product_id', 'week', 'year'],    // Target: Distribute to product-week level
  };

  const context: WorkflowContext = {
    editedKPI: 'Sls U',
    editedValue: 500000,
    aggregationContext,
  };

  return generateAggregatedEditWorkflow(context);
}

/**
 * Example 2: Department-level Sls U edit (month aggregation)
 *
 * Sls U config has:
 * - default: pro_rata
 * - time.year: historical
 *
 * Since this is a month-level edit (not year), it will use the default: pro_rata.
 */
export function example2_slsU_monthLevel() {
  // Define TIME aggregation
  const timeAggregation: TimeAggregation = {
    level: 'month',  // User editing at MONTH level
    // Map weeks → month (convert week number to month)
    sqlExpression: 'toMonth(toDate(year, 1, 1) + toIntervalWeek(week))',
  };

  // Define HIERARCHY aggregation
  const hierarchyAggregation: HierarchyAggregation = {
    level: 'dept',
    levels: ['dept'],
  };

  // Combine into aggregation context
  const aggregationContext: AggregationContext = {
    time: timeAggregation,
    hierarchy: hierarchyAggregation,
    where: "dept = 'Electronics' AND toMonth(toDate(year, 1, 1) + toIntervalWeek(week)) = 1 AND year = 2024",
    granularity: ['product_id', 'week', 'year'],
  };

  const context: WorkflowContext = {
    editedKPI: 'Sls U',
    editedValue: 50000,
    aggregationContext,
  };

  return generateAggregatedEditWorkflow(context);
}

/**
 * Example 3: BOP U edit at department level
 *
 * BOP U config has:
 * - default: equal
 * - hierarchy.dept: pro_rata
 *
 * Since this is a dept-level edit, it will use pro_rata.
 */
export function example3_bopU_deptLevel() {
  const aggregationContext: AggregationContext = {
    hierarchy: {
      level: 'dept',
      levels: ['dept'],
    },
    where: "dept = 'Electronics' AND year = 2024",
    granularity: ['product_id', 'week', 'year'],
  };

  const context: WorkflowContext = {
    editedKPI: 'BOP U',
    editedValue: 100000,
    aggregationContext,
  };

  return generateAggregatedEditWorkflow(context);
}

/**
 * Example 4: DR% (discount rate) edit at month level
 *
 * DR% config has:
 * - default: equal
 *
 * Will distribute evenly across all product-weeks.
 */
export function example4_drPercent_monthLevel() {
  const aggregationContext: AggregationContext = {
    time: {
      level: 'month',
      sqlExpression: 'toMonth(toDate(year, 1, 1) + toIntervalWeek(week))',
    },
    hierarchy: {
      level: 'dept',
      levels: ['dept'],
    },
    where: "dept = 'Electronics' AND toMonth(toDate(year, 1, 1) + toIntervalWeek(week)) = 1 AND year = 2024",
    granularity: ['product_id', 'week', 'year'],
  };

  const context: WorkflowContext = {
    editedKPI: 'DR%',
    editedValue: 0.15,  // 15% discount
    aggregationContext,
  };

  return generateAggregatedEditWorkflow(context);
}

/**
 * Example 5: AUC (cost) edit at year level
 *
 * AUC config has:
 * - default: historical (lookback 1 year)
 *
 * Will use historical cost patterns from previous year.
 */
export function example5_auc_yearLevel() {
  const aggregationContext: AggregationContext = {
    time: {
      level: 'year',
      sqlExpression: 'year',
    },
    hierarchy: {
      level: 'dept',
      levels: ['dept'],
    },
    where: "dept = 'Electronics' AND year = 2024",
    granularity: ['product_id', 'week', 'year'],
  };

  const context: WorkflowContext = {
    editedKPI: 'AUC',
    editedValue: 8.50,  // Average unit cost
    aggregationContext,
  };

  return generateAggregatedEditWorkflow(context);
}

/**
 * Example 6: Single-product edit (no allocation)
 *
 * Direct edit at granular level - no distribution needed.
 */
export function example6_singleProduct() {
  const context: WorkflowContext = {
    editedKPI: 'Sls U',
    editedValue: 150,
    productId: 'P001',
    week: 14,
    year: 2024,
  };

  return generateSingleProductEditWorkflow(context);
}

/**
 * Example 7: Multi-hierarchy edit (subdept level)
 *
 * Editing at sub-department level (more specific than department).
 */
export function example7_slsU_subdeptLevel() {
  const aggregationContext: AggregationContext = {
    time: {
      level: 'quarter',
      sqlExpression: 'toQuarter(toDate(year, 1, 1) + toIntervalWeek(week))',
    },
    hierarchy: {
      level: 'subdept',
      levels: ['dept', 'subdept'],
    },
    where: "dept = 'Electronics' AND subdept = 'Televisions' AND toQuarter(toDate(year, 1, 1) + toIntervalWeek(week)) = 1 AND year = 2024",
    granularity: ['product_id', 'week', 'year'],
  };

  const context: WorkflowContext = {
    editedKPI: 'Sls U',
    editedValue: 120000,
    aggregationContext,
  };

  return generateAggregatedEditWorkflow(context);
}

/**
 * Print example workflow for inspection
 */
export function printExampleWorkflow(exampleNum: number) {
  const examples = [
    example1_slsU_yearLevel,
    example2_slsU_monthLevel,
    example3_bopU_deptLevel,
    example4_drPercent_monthLevel,
    example5_auc_yearLevel,
    example6_singleProduct,
    example7_slsU_subdeptLevel,
  ];

  if (exampleNum < 1 || exampleNum > examples.length) {
    console.error(`Example ${exampleNum} not found. Valid range: 1-${examples.length}`);
    return;
  }

  const workflow = examples[exampleNum - 1]();
  console.log(JSON.stringify(workflow, null, 2));
}

/**
 * Dry run demonstration: Department + Month edit with pro-rata
 *
 * Scenario: User edits "Electronics, January 2024, Sls U = 50,000"
 *
 * Current state (Electronics products, Jan weeks):
 * - P001, Week 1: 100 units
 * - P001, Week 2: 150 units
 * - P002, Week 1: 200 units
 * - P002, Week 2: 250 units
 * - ... (more products/weeks)
 * Total current: 48,000 units
 *
 * KPI config for Sls U:
 * - time.year: historical strategy
 * - default: pro_rata strategy  ← Will use this for month-level
 *
 * Step 1: Get allocation strategy
 *   - Check KPI config for Sls U
 *   - Aggregation level is "month" (not "year")
 *   - Use default strategy: pro_rata
 *
 * Step 2: Calculate current aggregate
 *   SELECT SUM(sls_u) FROM kpi_data WHERE dept = 'Electronics' AND month = 1
 *   Result: 48,000
 *
 * Step 3: Calculate pro-rata weights
 *   P001, Week 1: 100 / 48000 = 0.00208 (0.208%)
 *   P001, Week 2: 150 / 48000 = 0.00312 (0.312%)
 *   P002, Week 1: 200 / 48000 = 0.00417 (0.417%)
 *   P002, Week 2: 250 / 48000 = 0.00521 (0.521%)
 *   ...
 *
 * Step 4: Calculate deltas
 *   Total delta: 50,000 - 48,000 = 2,000
 *   P001, Week 1: 2000 * 0.00208 = 4.16
 *   P001, Week 2: 2000 * 0.00312 = 6.24
 *   P002, Week 1: 2000 * 0.00417 = 8.34
 *   P002, Week 2: 2000 * 0.00521 = 10.42
 *   ...
 *
 * Step 5: Apply edits
 *   P001, Week 1: 100 + 4.16 = 104.16 ✓
 *   P001, Week 2: 150 + 6.24 = 156.24 ✓
 *   P002, Week 1: 200 + 8.34 = 208.34 ✓
 *   P002, Week 2: 250 + 10.42 = 260.42 ✓
 *   ...
 *   Total: 50,000 ✓
 *
 * Step 6: Validate (if enabled)
 *   SELECT SUM(sls_u) FROM kpi_data WHERE dept = 'Electronics' AND month = 1
 *   Expected: 50,000
 *   Actual: 50,000
 *   Difference: 0 (< tolerance 0.01) ✓
 *
 * Step 7+: Rebalance dependent KPIs
 *   Level 0: GM $, WOS (formulas depend on Sls U)
 *   Level 1: GM% (formula depends on GM $)
 *   ...
 *   All recalculated from formulas - NO distribution for dependent KPIs!
 */
