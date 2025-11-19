/**
 * Workflow Generation Examples
 *
 * Demonstrates config-driven allocation across time and hierarchies
 */

import type { WorkflowContext, AllocationConfig } from './types';
import {
  generateAggregatedEditWorkflow,
  generateSingleProductEditWorkflow,
} from './workflowGenerator';

/**
 * Example 1: Department-level edit for entire year
 * Distribution: Pro-rata across products and weeks
 *
 * Scenario:
 * - User edits: "Electronics Department, 2024, Sls U = 500,000"
 * - Current aggregate: 480,000
 * - Delta: +20,000
 * - Strategy: Distribute proportionally to current product-week values
 */
export function example1_departmentYearProRata() {
  const allocationConfig: AllocationConfig = {
    strategy: 'pro_rata',

    aggregation: {
      // Edit at department + year level
      time: {
        editLevel: 'year',
        storageLevel: 'week',
        mapping: {
          sqlExpression: 'year', // Group weeks by year
        },
      },
      hierarchy: {
        editLevel: ['dept'], // Editing at department level
        storageLevel: ['product_id', 'hierarchy_code', 'dept', 'channel'], // Storage granularity
      },
      where: "dept = 'Electronics' AND year = 2024",
    },

    distribution: {
      granularity: ['product_id', 'week', 'year'], // Distribute to product-week level
    },
  };

  const context: WorkflowContext = {
    editedKPI: 'Sls U',
    editedValue: 500000,
    allocationConfig,
  };

  return generateAggregatedEditWorkflow(context);
}

/**
 * Example 2: Month-level edit with equal distribution
 * Distribution: Equal allocation across products for all weeks in January
 *
 * Scenario:
 * - User edits: "Apparel Department, January 2024, Sls U = 50,000"
 * - Strategy: Distribute equally across all product-weeks in January
 */
export function example2_monthEqualDistribution() {
  const allocationConfig: AllocationConfig = {
    strategy: 'equal',

    aggregation: {
      // Edit at month level
      time: {
        editLevel: 'month',
        storageLevel: 'week',
        mapping: {
          // Map weeks to their month
          sqlExpression: 'toMonth(toDate(year, 1, 1) + toIntervalWeek(week))',
        },
      },
      hierarchy: {
        editLevel: ['dept'],
        storageLevel: ['product_id', 'hierarchy_code', 'dept', 'channel'],
      },
      where: "dept = 'Apparel' AND toMonth(toDate(year, 1, 1) + toIntervalWeek(week)) = 1 AND year = 2024",
    },

    distribution: {
      granularity: ['product_id', 'week', 'year'],
    },
  };

  const context: WorkflowContext = {
    editedKPI: 'Sls U',
    editedValue: 50000,
    allocationConfig,
  };

  return generateAggregatedEditWorkflow(context);
}

/**
 * Example 3: Quarter-level edit with historical patterns
 * Distribution: Based on historical sales patterns from previous 2 years
 *
 * Scenario:
 * - User edits: "Electronics, Q1 2024, Sls U = 120,000"
 * - Strategy: Use historical Q1 patterns (2022, 2023) to distribute
 */
export function example3_quarterHistoricalPatterns() {
  const allocationConfig: AllocationConfig = {
    strategy: 'historical',

    aggregation: {
      time: {
        editLevel: 'quarter',
        storageLevel: 'week',
        mapping: {
          sqlExpression: 'toQuarter(toDate(year, 1, 1) + toIntervalWeek(week))',
        },
      },
      hierarchy: {
        editLevel: ['dept'],
        storageLevel: ['product_id', 'hierarchy_code', 'dept', 'channel'],
      },
      where: "dept = 'Electronics' AND toQuarter(toDate(year, 1, 1) + toIntervalWeek(week)) = 1 AND year = 2024",
    },

    distribution: {
      granularity: ['product_id', 'week', 'year'],
    },

    historical: {
      lookbackYears: 2, // Use 2022, 2023 data
      sameTimePeriod: true, // Match Q1 only
    },
  };

  const context: WorkflowContext = {
    editedKPI: 'Sls U',
    editedValue: 120000,
    allocationConfig,
  };

  return generateAggregatedEditWorkflow(context);
}

/**
 * Example 4: Multi-level hierarchy with weighted distribution
 * Distribution: Priority-based weights (A-tier products get 3x, B-tier 2x, C-tier 1x)
 *
 * Scenario:
 * - User edits: "Electronics, Online Channel, 2024, Sls U = 300,000"
 * - Strategy: Distribute based on product tier priorities
 */
export function example4_hierarchyWeightedDistribution() {
  const allocationConfig: AllocationConfig = {
    strategy: 'weighted',

    aggregation: {
      time: {
        editLevel: 'year',
        storageLevel: 'week',
        mapping: {
          sqlExpression: 'year',
        },
      },
      hierarchy: {
        editLevel: ['dept', 'channel'], // Edit at dept + channel level
        storageLevel: ['product_id', 'hierarchy_code', 'dept', 'channel'],
      },
      where: "dept = 'Electronics' AND channel = 'Online' AND year = 2024",
    },

    distribution: {
      granularity: ['product_id', 'week', 'year'],
    },

    weights: {
      column: 'product_tier', // Fictional tier column
      mapping: {
        A: 3.0, // A-tier gets 3x weight
        B: 2.0, // B-tier gets 2x weight
        C: 1.0, // C-tier gets 1x weight
      },
    },
  };

  const context: WorkflowContext = {
    editedKPI: 'Sls U',
    editedValue: 300000,
    allocationConfig,
  };

  return generateAggregatedEditWorkflow(context);
}

/**
 * Example 5: Custom allocation logic
 * Distribution: User-provided SQL for complex business rules
 *
 * Scenario:
 * - User edits: "Home Department, 2024, Sls U = 200,000"
 * - Strategy: Custom SQL that combines historical + seasonal factors
 */
export function example5_customAllocationLogic() {
  const allocationConfig: AllocationConfig = {
    strategy: 'custom',

    aggregation: {
      time: {
        editLevel: 'year',
        storageLevel: 'week',
        mapping: {
          sqlExpression: 'year',
        },
      },
      hierarchy: {
        editLevel: ['dept'],
        storageLevel: ['product_id', 'hierarchy_code', 'dept', 'channel'],
      },
      where: "dept = 'Home' AND year = 2024",
    },

    distribution: {
      granularity: ['product_id', 'week', 'year'],
    },

    customWeightSQL: `
-- Custom logic: Blend historical patterns with seasonal factors
WITH historical AS (
  SELECT
    product_id,
    week,
    AVG(sls_u) as avg_historical_sls
  FROM kpi_data
  WHERE dept = 'Home'
    AND year IN (2022, 2023)
  GROUP BY product_id, week
),
seasonal_factors AS (
  SELECT
    week,
    CASE
      WHEN week BETWEEN 1 AND 13 THEN 0.8   -- Q1: Lower
      WHEN week BETWEEN 14 AND 26 THEN 1.0  -- Q2: Normal
      WHEN week BETWEEN 27 AND 39 THEN 1.2  -- Q3: Higher
      ELSE 1.5                               -- Q4: Peak (holidays)
    END as seasonal_factor
  FROM (SELECT DISTINCT week FROM kpi_data WHERE year = 2024)
),
weighted_values AS (
  SELECT
    h.product_id,
    h.week,
    h.avg_historical_sls * s.seasonal_factor as weighted_value
  FROM historical h
  JOIN seasonal_factors s ON h.week = s.week
),
totals AS (
  SELECT SUM(weighted_value) as total_weight
  FROM weighted_values
)
SELECT
  w.product_id,
  w.week,
  2024 as year,
  w.weighted_value / t.total_weight as weight
FROM weighted_values w
CROSS JOIN totals t
`,
  };

  const context: WorkflowContext = {
    editedKPI: 'Sls U',
    editedValue: 200000,
    allocationConfig,
  };

  return generateAggregatedEditWorkflow(context);
}

/**
 * Example 6: Single-product edit (no allocation needed)
 *
 * Scenario:
 * - User edits: "Product P001, Week 14, 2024, Sls U = 150"
 * - No distribution needed - direct update + rebalance
 */
export function example6_singleProductEdit() {
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
 * Example 7: Complex multi-hierarchy allocation
 * Distribution: Department → Sub-department → Category → Product
 *
 * Scenario:
 * - User edits: "Electronics, Televisions Sub-dept, Q2 2024, Sls U = 80,000"
 * - Strategy: Pro-rata across all TV products for Q2 weeks
 */
export function example7_multiHierarchyProRata() {
  const allocationConfig: AllocationConfig = {
    strategy: 'pro_rata',

    aggregation: {
      time: {
        editLevel: 'quarter',
        storageLevel: 'week',
        mapping: {
          sqlExpression: 'toQuarter(toDate(year, 1, 1) + toIntervalWeek(week))',
        },
      },
      hierarchy: {
        editLevel: ['dept', 'sub_dept'], // Edit at dept + sub-dept level
        storageLevel: ['product_id', 'hierarchy_code', 'dept', 'sub_dept', 'category', 'channel'],
        rollupPath: ['product_id', 'category', 'sub_dept', 'dept'], // Hierarchy rollup path
      },
      where: "dept = 'Electronics' AND sub_dept = 'Televisions' AND toQuarter(toDate(year, 1, 1) + toIntervalWeek(week)) = 2 AND year = 2024",
    },

    distribution: {
      granularity: ['product_id', 'week', 'year'],
    },
  };

  const context: WorkflowContext = {
    editedKPI: 'Sls U',
    editedValue: 80000,
    allocationConfig,
  };

  return generateAggregatedEditWorkflow(context);
}

/**
 * Print example workflow for inspection
 */
export function printExampleWorkflow(exampleNum: number) {
  const examples = [
    example1_departmentYearProRata,
    example2_monthEqualDistribution,
    example3_quarterHistoricalPatterns,
    example4_hierarchyWeightedDistribution,
    example5_customAllocationLogic,
    example6_singleProductEdit,
    example7_multiHierarchyProRata,
  ];

  if (exampleNum < 1 || exampleNum > examples.length) {
    console.error(`Example ${exampleNum} not found. Valid range: 1-${examples.length}`);
    return;
  }

  const workflow = examples[exampleNum - 1]();
  console.log(JSON.stringify(workflow, null, 2));
}

/**
 * Dry run: Show what happens with actual numbers
 *
 * Example: Electronics Dept, January 2024, Sls U edited to 50,000
 *
 * Current state:
 * - Product P001, Week 1: 100 units (weight: 0.05 = 100/2000)
 * - Product P001, Week 2: 150 units (weight: 0.075 = 150/2000)
 * - Product P002, Week 1: 200 units (weight: 0.10 = 200/2000)
 * - Product P002, Week 2: 250 units (weight: 0.125 = 250/2000)
 * - ... (20 more product-weeks totaling 1300 units)
 * - Total current: 2000 units
 *
 * After edit to 50,000:
 * - Delta: +48,000
 * - P001, Week 1: 100 + (48000 * 0.05) = 100 + 2400 = 2500
 * - P001, Week 2: 150 + (48000 * 0.075) = 150 + 3600 = 3750
 * - P002, Week 1: 200 + (48000 * 0.10) = 200 + 4800 = 5000
 * - P002, Week 2: 250 + (48000 * 0.125) = 250 + 6000 = 6250
 * - ... (remaining distributed proportionally)
 * - Total after: 50,000 ✓
 *
 * Workflow steps:
 * 1. Calculate current aggregate: 2000
 * 2. Calculate weights: pro_rata based on current values
 * 3. Calculate deltas: (50000 - 2000) * weight for each record
 * 4. Apply edits: Add delta to each product-week
 * 5. Rebalance: GM $, GM%, WOS, etc. (dependent KPIs)
 */
