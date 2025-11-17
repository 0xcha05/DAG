/**
 * Custom KPI Handlers
 * For KPIs that require complex business logic beyond simple formulas
 */

import type { KPIName, ProductData } from '../types';

export type CustomKPIHandler = (
  productData: ProductData,
  week: number,
  context?: Record<string, number>
) => number;

/**
 * Registry of custom KPI handlers
 * Maps KPI name to custom calculation function
 */
export const customKPIHandlers: Record<string, CustomKPIHandler> = {
  /**
   * Forward Weeks of Supply (FWOS)
   * Custom logic: BOP U / Sls U (simple division with safety check)
   */
  FWOS: (productData, week) => {
    const weekData = productData.weeks.get(week);
    if (!weekData) return 0;

    const bopU = weekData.values['BOP U'];
    const slsU = weekData.values['Sls U'];

    // Avoid division by zero
    if (slsU === 0) return 0;

    return bopU / slsU;
  },

  /**
   * Recommended Receipts Units (Rec Rcpt U)
   * Complex logic: Calculate optimal order quantity based on:
   * - Target weeks of supply (e.g., 4 weeks)
   * - Current inventory
   * - Forecasted sales (average of next 3 weeks)
   */
  'Rec Rcpt U': (productData, week) => {
    const weekData = productData.weeks.get(week);
    if (!weekData) return 0;

    const TARGET_WEEKS_OF_SUPPLY = 4;
    const FORECAST_WEEKS = 3;

    // Get current inventory
    const currentInventory = weekData.values['BOP U'];
    const currentSales = weekData.values['Sls U'];

    // Calculate forecasted average sales (look ahead 3 weeks)
    let totalForecastedSales = currentSales;
    let weeksFound = 1;

    for (let i = 1; i <= FORECAST_WEEKS; i++) {
      const futureWeek = productData.weeks.get(week + i);
      if (futureWeek) {
        totalForecastedSales += futureWeek.values['Sls U'];
        weeksFound++;
      }
    }

    const avgWeeklySales = totalForecastedSales / weeksFound;

    // Calculate target inventory
    const targetInventory = avgWeeklySales * TARGET_WEEKS_OF_SUPPLY;

    // Calculate recommended receipts
    const recommendedReceipts = Math.max(0, targetInventory - currentInventory);

    return Math.round(recommendedReceipts);
  },

  /**
   * Smart Reorder Point
   * Highly complex logic:
   * - Statistical analysis of sales variance
   * - Lead time consideration
   * - Service level target (95%)
   * - Safety stock calculation
   * - Seasonal adjustment
   */
  'Smart Reorder Point': (productData, week) => {
    const LEAD_TIME_WEEKS = 2;
    const SERVICE_LEVEL_Z = 1.645; // 95% service level
    const LOOKBACK_WEEKS = 4;

    const weekData = productData.weeks.get(week);
    if (!weekData) return 0;

    // Step 1: Calculate average demand over lookback period
    const salesHistory: number[] = [];
    for (let i = 0; i < LOOKBACK_WEEKS; i++) {
      const historicalWeek = productData.weeks.get(week - i);
      if (historicalWeek) {
        salesHistory.push(historicalWeek.values['Sls U']);
      }
    }

    if (salesHistory.length === 0) return 0;

    const avgDemand = salesHistory.reduce((sum, s) => sum + s, 0) / salesHistory.length;

    // Step 2: Calculate standard deviation of demand
    const variance =
      salesHistory.reduce((sum, s) => sum + Math.pow(s - avgDemand, 2), 0) /
      salesHistory.length;
    const stdDev = Math.sqrt(variance);

    // Step 3: Calculate demand during lead time
    const leadTimeDemand = avgDemand * LEAD_TIME_WEEKS;

    // Step 4: Calculate safety stock
    // Formula: Z * σ * √(Lead Time)
    const safetyStock = SERVICE_LEVEL_Z * stdDev * Math.sqrt(LEAD_TIME_WEEKS);

    // Step 5: Check for seasonality (compare to same week in history)
    let seasonalFactor = 1.0;
    const sameWeekLastCycle = productData.weeks.get(week - 8); // 8 weeks back
    if (sameWeekLastCycle && avgDemand > 0) {
      const lastCycleSales = sameWeekLastCycle.values['Sls U'];
      seasonalFactor = lastCycleSales / avgDemand;
      // Cap seasonal adjustment between 0.8 and 1.5
      seasonalFactor = Math.max(0.8, Math.min(1.5, seasonalFactor));
    }

    // Step 6: Calculate reorder point
    const reorderPoint = leadTimeDemand * seasonalFactor + safetyStock;

    return Math.round(reorderPoint);
  },

  /**
   * Promotional Lift %
   * Compares current performance to baseline
   * - Baseline: Average of non-promo weeks
   * - Looks at DR% to identify promo weeks (DR% > 15% = promo)
   * - Calculates lift percentage
   */
  'Promo Lift %': (productData, week) => {
    const PROMO_THRESHOLD_DR = 0.15; // 15% discount = promo
    const BASELINE_WEEKS = 4;

    const weekData = productData.weeks.get(week);
    if (!weekData) return 0;

    const currentSales = weekData.values['Sls U'];
    const currentDR = weekData.values['DR%'];

    // If not a promo week, return 0
    if (currentDR <= PROMO_THRESHOLD_DR) return 0;

    // Calculate baseline from non-promo weeks
    const baselineSales: number[] = [];
    for (let i = 1; i <= BASELINE_WEEKS + 2; i++) {
      const historicalWeek = productData.weeks.get(week - i);
      if (historicalWeek) {
        const dr = historicalWeek.values['DR%'];
        // Only include non-promo weeks
        if (dr <= PROMO_THRESHOLD_DR) {
          baselineSales.push(historicalWeek.values['Sls U']);
          if (baselineSales.length >= BASELINE_WEEKS) break;
        }
      }
    }

    if (baselineSales.length === 0) return 0;

    const avgBaseline = baselineSales.reduce((sum, s) => sum + s, 0) / baselineSales.length;

    if (avgBaseline === 0) return 0;

    // Calculate lift percentage
    const lift = ((currentSales - avgBaseline) / avgBaseline) * 100;

    return lift;
  },

  /**
   * Dynamic Markdown Price
   * Uses pricing algorithm based on:
   * - Current inventory position
   * - Weeks remaining in season
   * - Target clearance rate
   */
  'Dynamic MD Price': (productData, week) => {
    const SEASON_END_WEEK = 15;
    const TARGET_CLEARANCE_RATE = 0.9; // 90% clearance target

    const weekData = productData.weeks.get(week);
    if (!weekData) return 0;

    const currentInventory = weekData.values['BOP U'];
    const aur = weekData.values['AUR'];
    const weeksRemaining = SEASON_END_WEEK - week;

    if (weeksRemaining <= 0) return aur * 0.5; // Deep discount at end

    // Calculate ideal weekly sell-through rate
    const targetWeeklySellThrough = (currentInventory * TARGET_CLEARANCE_RATE) / weeksRemaining;

    // Get actual sell-through from last week
    const lastWeek = productData.weeks.get(week - 1);
    const actualSellThrough = lastWeek ? lastWeek.values['Sls U'] : 0;

    // Calculate performance ratio
    const performanceRatio =
      targetWeeklySellThrough > 0 ? actualSellThrough / targetWeeklySellThrough : 1;

    // Adjust price based on performance
    let priceMultiplier = 1.0;

    if (performanceRatio < 0.7) {
      // Underperforming - increase markdown
      priceMultiplier = 0.7;
    } else if (performanceRatio < 0.9) {
      priceMultiplier = 0.85;
    } else if (performanceRatio > 1.2) {
      // Overperforming - reduce markdown
      priceMultiplier = 0.95;
    } else {
      priceMultiplier = 0.9;
    }

    return aur * priceMultiplier;
  },
};

/**
 * Check if a KPI has a custom handler
 */
export function hasCustomHandler(kpiName: KPIName): boolean {
  return kpiName in customKPIHandlers;
}

/**
 * Execute custom KPI handler
 */
export function executeCustomHandler(
  kpiName: KPIName,
  productData: ProductData,
  week: number,
  context?: Record<string, number>
): number {
  const handler = customKPIHandlers[kpiName];
  if (!handler) {
    throw new Error(`No custom handler found for KPI: ${kpiName}`);
  }

  return handler(productData, week, context);
}

/**
 * Get description of custom handler logic (for documentation/display)
 */
export function getCustomHandlerDescription(kpiName: KPIName): string {
  const descriptions: Record<string, string> = {
    FWOS: 'Divides Beginning of Period Units by Sales Units to calculate weeks of supply',
    'Rec Rcpt U':
      'Calculates optimal order quantity based on target 4 weeks of supply and forecasted sales (3-week average)',
    'Smart Reorder Point':
      'Statistical reorder point using variance analysis, lead time (2 weeks), 95% service level, safety stock, and seasonal adjustment',
    'Promo Lift %':
      'Measures promotional effectiveness by comparing sales to non-promotional baseline (4-week average)',
    'Dynamic MD Price':
      'Dynamic markdown pricing algorithm based on inventory position, weeks remaining, and clearance targets',
  };

  return descriptions[kpiName] || 'Custom calculation logic';
}

/**
 * Get SQL representation for custom handler (for ClickHouse query generation)
 * Returns a description of what would need to be calculated
 */
export function getCustomHandlerSQL(
  kpiName: KPIName,
  productId: string,
  week: number
): { description: string; requiresMultiQuery: boolean; steps: string[] } {
  const sqlDescriptions: Record<
    string,
    { description: string; requiresMultiQuery: boolean; steps: string[] }
  > = {
    FWOS: {
      description: 'Simple division: BOP U / Sls U',
      requiresMultiQuery: false,
      steps: [
        `UPDATE kpi_data SET fwos = bop_u / NULLIF(sls_u, 0) WHERE product_id = '${productId}' AND week = ${week}`,
      ],
    },
    'Rec Rcpt U': {
      description:
        'Multi-step: Calculate 3-week average sales, compute target inventory (avg * 4 weeks), subtract current inventory',
      requiresMultiQuery: true,
      steps: [
        `-- Step 1: Calculate average forecasted sales`,
        `WITH forecast AS (
  SELECT AVG(sls_u) as avg_sales
  FROM kpi_data
  WHERE product_id = '${productId}'
  AND week >= ${week}
  AND week <= ${week + 3}
)`,
        `-- Step 2: Update Rec Rcpt U`,
        `UPDATE kpi_data
SET rec_rcpt_u = GREATEST(0, (forecast.avg_sales * 4) - bop_u)
FROM forecast
WHERE product_id = '${productId}' AND week = ${week}`,
      ],
    },
    'Smart Reorder Point': {
      description:
        'Complex statistical calculation: variance analysis, safety stock, lead time consideration, seasonal adjustment',
      requiresMultiQuery: true,
      steps: [
        `-- Step 1: Calculate historical stats (avg, stddev)`,
        `WITH historical_stats AS (
  SELECT
    AVG(sls_u) as avg_demand,
    STDDEV_POP(sls_u) as std_dev
  FROM kpi_data
  WHERE product_id = '${productId}'
  AND week >= ${week - 4}
  AND week < ${week}
)`,
        `-- Step 2: Calculate safety stock (Z * σ * √lead_time)`,
        `seasonal AS (
  SELECT sls_u as seasonal_sales
  FROM kpi_data
  WHERE product_id = '${productId}' AND week = ${week - 8}
)`,
        `-- Step 3: Calculate reorder point with seasonal adjustment`,
        `UPDATE kpi_data
SET smart_reorder_point =
  (historical_stats.avg_demand * 2) *
  CLAMP(seasonal.seasonal_sales / NULLIF(historical_stats.avg_demand, 0), 0.8, 1.5) +
  (1.645 * historical_stats.std_dev * SQRT(2))
FROM historical_stats, seasonal
WHERE product_id = '${productId}' AND week = ${week}`,
      ],
    },
    'Promo Lift %': {
      description: 'Compare current sales to baseline (non-promo weeks), calculate lift percentage',
      requiresMultiQuery: true,
      steps: [
        `-- Step 1: Calculate baseline from non-promo weeks`,
        `WITH baseline AS (
  SELECT AVG(sls_u) as avg_baseline
  FROM kpi_data
  WHERE product_id = '${productId}'
  AND week < ${week}
  AND dr_percent <= 0.15
  ORDER BY week DESC
  LIMIT 4
)`,
        `-- Step 2: Calculate lift %`,
        `UPDATE kpi_data
SET promo_lift_percent =
  CASE
    WHEN dr_percent > 0.15 THEN
      ((sls_u - baseline.avg_baseline) / NULLIF(baseline.avg_baseline, 0)) * 100
    ELSE 0
  END
FROM baseline
WHERE product_id = '${productId}' AND week = ${week}`,
      ],
    },
    'Dynamic MD Price': {
      description:
        'Dynamic pricing algorithm based on inventory position, season timeline, and performance',
      requiresMultiQuery: true,
      steps: [
        `-- Step 1: Calculate target and actual sell-through`,
        `WITH performance AS (
  SELECT
    (bop_u * 0.9) / (15 - week) as target_weekly,
    LAG(sls_u, 1) OVER (ORDER BY week) as actual_sales
  FROM kpi_data
  WHERE product_id = '${productId}' AND week = ${week}
)`,
        `-- Step 2: Calculate price multiplier based on performance`,
        `UPDATE kpi_data
SET dynamic_md_price = aur *
  CASE
    WHEN (performance.actual_sales / NULLIF(performance.target_weekly, 0)) < 0.7 THEN 0.7
    WHEN (performance.actual_sales / NULLIF(performance.target_weekly, 0)) < 0.9 THEN 0.85
    WHEN (performance.actual_sales / NULLIF(performance.target_weekly, 0)) > 1.2 THEN 0.95
    ELSE 0.9
  END
FROM performance
WHERE product_id = '${productId}' AND week = ${week}`,
      ],
    },
  };

  return (
    sqlDescriptions[kpiName] || {
      description: 'Custom calculation (requires application logic)',
      requiresMultiQuery: false,
      steps: [
        `-- Custom KPI: ${kpiName}`,
        `-- This KPI requires custom application logic`,
        `-- SQL generation not available`,
      ],
    }
  );
}
