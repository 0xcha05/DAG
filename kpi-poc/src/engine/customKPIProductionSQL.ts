/**
 * Production SQL Generation for Custom KPIs
 *
 * For 95 GB+ datasets, custom KPI logic must execute in ClickHouse, not in-memory.
 * This module generates production-ready, executable SQL for complex KPI calculations.
 *
 * Architecture:
 * - POC Mode: JavaScript handlers execute in-memory (for demo)
 * - Production Mode: SQL executes in ClickHouse (for 95 GB datasets)
 */

import type { KPIName } from '../types';

export interface ProductionSQL {
  kpiName: KPIName;
  description: string;

  // Complete executable SQL (can be run directly in ClickHouse)
  sql: string;

  // Whether this requires multiple queries or a single query
  requiresMultiQuery: boolean;

  // Step-by-step explanation for documentation/audit
  explanation: string[];

  // Parameters that need to be substituted
  parameters: {
    productId: string;
    week: number;
    year: number;
  };
}

/**
 * Generate production-ready SQL for Smart Reorder Point
 *
 * Business Logic:
 * - Calculate 4-week average demand
 * - Calculate standard deviation (variance)
 * - Lead time: 2 weeks
 * - Safety stock: Z-score (1.645 for 95% service level) * stddev * sqrt(lead_time)
 * - Seasonal adjustment: Compare to 8 weeks ago, cap between 0.8-1.5
 * - Formula: (avg_demand * 2) * seasonal_factor + safety_stock
 */
function generateSmartReorderPointSQL(
  productId: string,
  week: number,
  year: number
): ProductionSQL {
  return {
    kpiName: 'Smart Reorder Point',
    description: 'Statistical reorder point with variance, safety stock, and seasonality',
    requiresMultiQuery: false,
    sql: `
-- Smart Reorder Point Calculation
-- Designed for production use with 95 GB+ datasets
ALTER TABLE kpi_data
UPDATE smart_reorder_point = (
  -- Main calculation using CTEs for clarity
  WITH
  -- Step 1: Get historical sales (last 4 weeks)
  historical AS (
    SELECT
      AVG(sls_u) as avg_demand,
      stddevPop(sls_u) as std_dev
    FROM kpi_data
    WHERE product_id = {productId:String}
      AND year = {year:UInt16}
      AND week >= {week:UInt8} - 4
      AND week < {week:UInt8}
  ),
  -- Step 2: Get seasonal data (8 weeks ago for comparison)
  seasonal AS (
    SELECT sls_u as seasonal_sales
    FROM kpi_data
    WHERE product_id = {productId:String}
      AND year = {year:UInt16}
      AND week = {week:UInt8} - 8
    LIMIT 1
  ),
  -- Step 3: Calculate components
  components AS (
    SELECT
      h.avg_demand,
      h.std_dev,
      h.avg_demand * 2 as lead_time_demand,  -- 2 weeks lead time
      1.645 * h.std_dev * sqrt(2) as safety_stock,  -- 95% service level
      -- Seasonal adjustment (capped between 0.8 and 1.5)
      CASE
        WHEN h.avg_demand = 0 THEN 1.0
        ELSE greatest(0.8, least(1.5, s.seasonal_sales / h.avg_demand))
      END as seasonal_factor
    FROM historical h
    CROSS JOIN seasonal s
  )
  -- Final calculation
  SELECT round(lead_time_demand * seasonal_factor + safety_stock)
  FROM components
)
WHERE product_id = {productId:String}
  AND year = {year:UInt16}
  AND week = {week:UInt8}
`,
    explanation: [
      'Step 1: Calculate historical statistics (avg, stddev) from last 4 weeks',
      'Step 2: Get seasonal sales from 8 weeks ago',
      'Step 3: Calculate lead time demand (avg * 2 weeks)',
      'Step 4: Calculate safety stock (1.645 * stddev * sqrt(2)) for 95% service level',
      'Step 5: Calculate seasonal factor (ratio of 8-week-ago sales to avg, capped 0.8-1.5)',
      'Step 6: Final formula: (lead_time_demand * seasonal_factor) + safety_stock',
    ],
    parameters: {
      productId,
      week,
      year,
    },
  };
}

/**
 * Generate production SQL for Promo Lift %
 *
 * Business Logic:
 * - Identify promo weeks (DR% > 15%)
 * - Calculate baseline from up to 4 non-promo weeks
 * - Lift % = ((current_sales - baseline) / baseline) * 100
 */
function generatePromoLiftSQL(
  productId: string,
  week: number,
  year: number
): ProductionSQL {
  return {
    kpiName: 'Promo Lift %',
    description: 'Promotional lift vs non-promo baseline',
    requiresMultiQuery: false,
    sql: `
-- Promo Lift % Calculation
ALTER TABLE kpi_data
UPDATE promo_lift_percent = (
  WITH
  -- Get current week data
  current_week AS (
    SELECT sls_u, dr_percent
    FROM kpi_data
    WHERE product_id = {productId:String}
      AND year = {year:UInt16}
      AND week = {week:UInt8}
  ),
  -- Calculate baseline from non-promo weeks (DR% <= 15%)
  baseline AS (
    SELECT AVG(sls_u) as avg_baseline
    FROM (
      SELECT sls_u
      FROM kpi_data
      WHERE product_id = {productId:String}
        AND year = {year:UInt16}
        AND week < {week:UInt8}
        AND dr_percent <= 0.15
      ORDER BY week DESC
      LIMIT 4
    )
  )
  -- Calculate lift only if this is a promo week
  SELECT
    CASE
      WHEN c.dr_percent > 0.15 AND b.avg_baseline > 0 THEN
        ((c.sls_u - b.avg_baseline) / b.avg_baseline) * 100
      ELSE 0
    END
  FROM current_week c
  CROSS JOIN baseline b
)
WHERE product_id = {productId:String}
  AND year = {year:UInt16}
  AND week = {week:UInt8}
`,
    explanation: [
      'Step 1: Get current week sales and discount rate',
      'Step 2: Find up to 4 non-promo weeks (DR% <= 15%) before current week',
      'Step 3: Calculate average baseline sales from non-promo weeks',
      'Step 4: If current week is promo (DR% > 15%), calculate lift percentage',
      'Step 5: Lift % = ((current_sales - baseline) / baseline) * 100',
      'Step 6: Return 0 if not a promo week or baseline is 0',
    ],
    parameters: {
      productId,
      week,
      year,
    },
  };
}

/**
 * Generate production SQL for Recommended Receipts
 *
 * Business Logic:
 * - Calculate 3-week average sales (forecast)
 * - Target: 4 weeks of supply
 * - Receipts needed = (avg_sales * 4) - current_inventory
 */
function generateRecommendedReceiptsSQL(
  productId: string,
  week: number,
  year: number
): ProductionSQL {
  return {
    kpiName: 'Rec Rcpt U',
    description: 'Recommended receipts based on 3-week forecast and target WOS',
    requiresMultiQuery: false,
    sql: `
-- Recommended Receipts Calculation
ALTER TABLE kpi_data
UPDATE rec_rcpt_u = (
  WITH
  -- Calculate 3-week average sales (forecast)
  forecast AS (
    SELECT AVG(sls_u) as avg_sales
    FROM kpi_data
    WHERE product_id = {productId:String}
      AND year = {year:UInt16}
      AND week >= {week:UInt8}
      AND week <= {week:UInt8} + 3
  ),
  -- Get current inventory
  current_inventory AS (
    SELECT eop_u as current_inv
    FROM kpi_data
    WHERE product_id = {productId:String}
      AND year = {year:UInt16}
      AND week = {week:UInt8}
  )
  -- Calculate receipts needed (target 4 weeks of supply)
  SELECT greatest(0, round((f.avg_sales * 4) - c.current_inv))
  FROM forecast f
  CROSS JOIN current_inventory c
)
WHERE product_id = {productId:String}
  AND year = {year:UInt16}
  AND week = {week:UInt8}
`,
    explanation: [
      'Step 1: Calculate 3-week average sales (forecast demand)',
      'Step 2: Get current inventory (EOP U)',
      'Step 3: Calculate target inventory (avg_sales * 4 weeks)',
      'Step 4: Receipts needed = target - current inventory',
      'Step 5: Return maximum of 0 and calculated value (no negative receipts)',
    ],
    parameters: {
      productId,
      week,
      year,
    },
  };
}

/**
 * Main function to get production SQL for any custom KPI
 */
export function getProductionSQL(
  kpiName: KPIName,
  productId: string,
  week: number,
  year: number = 2024
): ProductionSQL | null {
  switch (kpiName) {
    case 'Smart Reorder Point':
      return generateSmartReorderPointSQL(productId, week, year);

    case 'Promo Lift %':
      return generatePromoLiftSQL(productId, week, year);

    case 'Rec Rcpt U':
      return generateRecommendedReceiptsSQL(productId, week, year);

    default:
      return null;
  }
}

/**
 * Check if a KPI has production SQL available
 */
export function hasProductionSQL(kpiName: KPIName): boolean {
  return ['Smart Reorder Point', 'Promo Lift %', 'Rec Rcpt U'].includes(kpiName);
}

/**
 * Format production SQL for display with parameters substituted
 */
export function formatProductionSQL(sql: ProductionSQL): string {
  let formatted = sql.sql;

  // Substitute parameters for display
  formatted = formatted.replace(/{productId:String}/g, `'${sql.parameters.productId}'`);
  formatted = formatted.replace(/{week:UInt8}/g, sql.parameters.week.toString());
  formatted = formatted.replace(/{year:UInt16}/g, sql.parameters.year.toString());

  return formatted;
}

/**
 * IMPORTANT: Batch SQL Generation for Multiple Products
 *
 * For production with 95 GB datasets, you'd batch-process multiple products:
 */
export function generateBatchProductionSQL(
  kpiName: KPIName,
  week: number,
  year: number
): string {
  // Example: Update ALL products in a single query (no productId filter)
  if (kpiName === 'Smart Reorder Point') {
    return `
-- BATCH: Update Smart Reorder Point for ALL products
ALTER TABLE kpi_data
UPDATE smart_reorder_point = (
  WITH
  historical AS (
    SELECT
      product_id,
      AVG(sls_u) as avg_demand,
      stddevPop(sls_u) as std_dev
    FROM kpi_data
    WHERE year = ${year}
      AND week >= ${week} - 4
      AND week < ${week}
    GROUP BY product_id
  ),
  seasonal AS (
    SELECT
      product_id,
      sls_u as seasonal_sales
    FROM kpi_data
    WHERE year = ${year}
      AND week = ${week} - 8
  ),
  components AS (
    SELECT
      h.product_id,
      h.avg_demand * 2 as lead_time_demand,
      1.645 * h.std_dev * sqrt(2) as safety_stock,
      CASE
        WHEN h.avg_demand = 0 THEN 1.0
        ELSE greatest(0.8, least(1.5, s.seasonal_sales / h.avg_demand))
      END as seasonal_factor
    FROM historical h
    LEFT JOIN seasonal s ON h.product_id = s.product_id
  )
  SELECT round(lead_time_demand * seasonal_factor + safety_stock)
  FROM components c
  WHERE c.product_id = kpi_data.product_id
)
WHERE year = ${year}
  AND week = ${week}
`;
  }

  return '';
}
