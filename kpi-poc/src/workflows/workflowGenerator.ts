/**
 * Workflow Generator for KPI Edits
 *
 * Generates executable workflow definitions for:
 * 1. Aggregated edits (department/month level) → Distribution to granular level (product/week)
 * 2. Single-product edits → Direct KPI rebalancing
 *
 * All allocation strategies are config-driven.
 */

import type { KPIName } from '../types';
import type {
  WorkflowDefinition,
  WorkflowStep,
  AllocationConfig,
  AllocationStrategy,
  WorkflowContext,
  TimeAggregation,
  HierarchyAggregation,
} from './types';
import { topologicalSort } from '../engine/topologicalSort';
import { kpiConfigs } from '../data/kpiConfig';

/**
 * Generate complete workflow for aggregated edit with allocation
 *
 * Example: User edits "Electronics Dept, January 2024, Sls U = 50,000"
 * → Distributes across all products in Electronics for all weeks in January
 */
export function generateAggregatedEditWorkflow(
  context: WorkflowContext
): WorkflowDefinition {
  if (!context.allocationConfig) {
    throw new Error('Allocation config required for aggregated edits');
  }

  const workflowId = `edit_${context.editedKPI.replace(/\s+/g, '_')}_${Date.now()}`;
  const steps: WorkflowStep[] = [];
  const config = context.allocationConfig;

  // Step 1: Calculate current aggregate value
  steps.push({
    step_id: `${workflowId}_calculate_current`,
    description: 'Calculate current aggregate value before edit',
    source_table: 'kpi_data',
    target_table: `tmp_${workflowId}_current_aggregate`,
    process_sql: generateAggregateQuerySQL(context.editedKPI, config),
    cleanup_source: false,
    dependencies: [],
  });

  // Step 2: Calculate allocation weights based on strategy
  steps.push({
    step_id: `${workflowId}_calculate_weights`,
    description: `Calculate allocation weights using ${config.strategy} strategy`,
    source_table: 'kpi_data',
    target_table: `tmp_${workflowId}_weights`,
    process_sql: generateAllocationWeightsSQL(context.editedKPI, config),
    cleanup_source: false,
    dependencies: [],
  });

  // Step 3: Calculate deltas to distribute
  steps.push({
    step_id: `${workflowId}_calculate_deltas`,
    description: 'Calculate delta to distribute across granular level',
    source_table: `tmp_${workflowId}_current_aggregate`,
    target_table: `tmp_${workflowId}_deltas`,
    process_sql: generateDeltaCalculationSQL(
      context.editedValue,
      config,
      `tmp_${workflowId}_current_aggregate`,
      `tmp_${workflowId}_weights`
    ),
    cleanup_source: true,
    dependencies: [`${workflowId}_calculate_current`, `${workflowId}_calculate_weights`],
  });

  // Step 4: Apply edits to granular level
  steps.push({
    step_id: `${workflowId}_apply_edits`,
    description: `Apply distributed edits to ${context.editedKPI}`,
    source_table: `tmp_${workflowId}_deltas`,
    target_table: 'kpi_data',
    process_sql: generateApplyEditsSQL(
      context.editedKPI,
      config,
      `tmp_${workflowId}_deltas`
    ),
    cleanup_source: true,
    dependencies: [`${workflowId}_calculate_deltas`],
  });

  // Step 5+: Rebalance dependent KPIs
  const rebalanceSteps = generateRebalancingSteps(
    workflowId,
    context.editedKPI,
    config
  );
  steps.push(...rebalanceSteps);

  return {
    workflow_id: workflowId,
    description: `Edit ${context.editedKPI} at aggregated level and rebalance dependent KPIs`,
    steps,
    memory_limits: {
      max_memory_mb: 2048,
      cleanup_threshold_mb: 1536,
    },
    max_parallel_steps: 4,
    timeout_seconds: 300,
  };
}

/**
 * Generate workflow for single-product edit (no allocation needed)
 *
 * Example: User edits "Product P001, Week 14, Sls U = 150"
 * → Direct update + rebalance dependent KPIs
 */
export function generateSingleProductEditWorkflow(
  context: WorkflowContext
): WorkflowDefinition {
  if (!context.productId || !context.week || !context.year) {
    throw new Error('Product ID, week, and year required for single-product edits');
  }

  const workflowId = `edit_${context.editedKPI.replace(/\s+/g, '_')}_${Date.now()}`;
  const steps: WorkflowStep[] = [];

  // Step 1: Apply direct edit
  steps.push({
    step_id: `${workflowId}_apply_edit`,
    description: `Update ${context.editedKPI} for product ${context.productId}`,
    source_table: 'kpi_data',
    target_table: 'kpi_data',
    process_sql: `
ALTER TABLE kpi_data
UPDATE ${getKPIColumnName(context.editedKPI)} = ${context.editedValue}
WHERE product_id = '${context.productId}'
  AND year = ${context.year}
  AND week = ${context.week}
`,
    cleanup_source: false,
    dependencies: [],
  });

  // Step 2+: Rebalance dependent KPIs
  const rebalanceSteps = generateRebalancingStepsForSingleProduct(
    workflowId,
    context.editedKPI,
    context.productId,
    context.week,
    context.year
  );
  steps.push(...rebalanceSteps);

  return {
    workflow_id: workflowId,
    description: `Edit ${context.editedKPI} for single product and rebalance`,
    steps,
    memory_limits: {
      max_memory_mb: 512,
      cleanup_threshold_mb: 384,
    },
    max_parallel_steps: 4,
    timeout_seconds: 120,
  };
}

/**
 * Generate SQL to calculate current aggregate value
 */
function generateAggregateQuerySQL(
  kpiName: KPIName,
  config: AllocationConfig
): string {
  const kpiColumn = getKPIColumnName(kpiName);
  const { time, hierarchy, where } = config.aggregation;

  // Build time grouping expression
  const timeGroupExpr = generateTimeGroupExpression(time);

  // Build hierarchy grouping columns
  const hierarchyGroupCols = hierarchy.editLevel.join(', ');

  return `
-- Calculate current aggregate value
SELECT
  ${timeGroupExpr} as time_group,
  ${hierarchyGroupCols},
  SUM(${kpiColumn}) as current_value
FROM kpi_data
WHERE ${where}
GROUP BY time_group, ${hierarchyGroupCols}
`;
}

/**
 * Generate SQL to calculate allocation weights based on strategy
 */
function generateAllocationWeightsSQL(
  kpiName: KPIName,
  config: AllocationConfig
): string {
  const { strategy } = config;

  switch (strategy) {
    case 'pro_rata':
      return generateProRataWeightsSQL(kpiName, config);
    case 'equal':
      return generateEqualWeightsSQL(kpiName, config);
    case 'historical':
      return generateHistoricalWeightsSQL(kpiName, config);
    case 'weighted':
      return generateWeightedWeightsSQL(kpiName, config);
    case 'custom':
      return config.customWeightSQL || 'SELECT 1 as weight';
    default:
      throw new Error(`Unknown allocation strategy: ${strategy}`);
  }
}

/**
 * Pro-rata allocation: Distribute proportionally to current values
 */
function generateProRataWeightsSQL(
  kpiName: KPIName,
  config: AllocationConfig
): string {
  const kpiColumn = getKPIColumnName(kpiName);
  const { time, hierarchy, where } = config.aggregation;
  const { granularity } = config.distribution;

  const timeMapExpr = time.mapping.sqlExpression;
  const hierarchyGroupCols = hierarchy.editLevel.join(', ');
  const granularityCols = granularity.join(', ');

  return `
-- Pro-rata weights: proportional to current values
WITH granular_values AS (
  SELECT
    ${timeMapExpr} as time_group,
    ${hierarchyGroupCols},
    ${granularityCols},
    ${kpiColumn} as current_value
  FROM kpi_data
  WHERE ${where}
),
totals AS (
  SELECT
    time_group,
    ${hierarchyGroupCols},
    SUM(current_value) as total_value
  FROM granular_values
  GROUP BY time_group, ${hierarchyGroupCols}
)
SELECT
  g.time_group,
  ${granularityCols.split(', ').map(col => `g.${col}`).join(', ')},
  CASE
    WHEN t.total_value = 0 THEN 0
    ELSE g.current_value / t.total_value
  END as weight
FROM granular_values g
JOIN totals t
  ON g.time_group = t.time_group
  ${hierarchy.editLevel.map(col => `AND g.${col} = t.${col}`).join('\n  ')}
`;
}

/**
 * Equal allocation: Distribute evenly across all granular records
 */
function generateEqualWeightsSQL(
  kpiName: KPIName,
  config: AllocationConfig
): string {
  const { time, hierarchy, where } = config.aggregation;
  const { granularity } = config.distribution;

  const timeMapExpr = time.mapping.sqlExpression;
  const hierarchyGroupCols = hierarchy.editLevel.join(', ');
  const granularityCols = granularity.join(', ');

  return `
-- Equal weights: distribute evenly
WITH granular_records AS (
  SELECT
    ${timeMapExpr} as time_group,
    ${hierarchyGroupCols},
    ${granularityCols}
  FROM kpi_data
  WHERE ${where}
),
counts AS (
  SELECT
    time_group,
    ${hierarchyGroupCols},
    COUNT(*) as record_count
  FROM granular_records
  GROUP BY time_group, ${hierarchyGroupCols}
)
SELECT
  g.time_group,
  ${granularityCols.split(', ').map(col => `g.${col}`).join(', ')},
  1.0 / c.record_count as weight
FROM granular_records g
JOIN counts c
  ON g.time_group = c.time_group
  ${hierarchy.editLevel.map(col => `AND g.${col} = c.${col}`).join('\n  ')}
`;
}

/**
 * Historical allocation: Based on historical patterns
 */
function generateHistoricalWeightsSQL(
  kpiName: KPIName,
  config: AllocationConfig
): string {
  if (!config.historical) {
    throw new Error('Historical config required for historical strategy');
  }

  const kpiColumn = getKPIColumnName(kpiName);
  const { time, hierarchy, where } = config.aggregation;
  const { granularity } = config.distribution;
  const { lookbackYears, sameTimePeriod } = config.historical;

  const timeMapExpr = time.mapping.sqlExpression;
  const hierarchyGroupCols = hierarchy.editLevel.join(', ');
  const granularityCols = granularity.join(', ');

  // Extract year from where clause for lookback calculation
  const yearMatch = where.match(/year\s*=\s*(\d+)/);
  const currentYear = yearMatch ? parseInt(yearMatch[1]) : 2024;
  const lookbackYearStart = currentYear - lookbackYears;

  const timePeriodCondition = sameTimePeriod
    ? `AND ${timeMapExpr} = (SELECT ${timeMapExpr} FROM kpi_data WHERE ${where} LIMIT 1)`
    : '';

  return `
-- Historical weights: based on past ${lookbackYears} years
WITH historical_values AS (
  SELECT
    ${timeMapExpr} as time_group,
    ${hierarchyGroupCols},
    ${granularityCols},
    AVG(${kpiColumn}) as avg_historical_value
  FROM kpi_data
  WHERE year >= ${lookbackYearStart} AND year < ${currentYear}
    ${timePeriodCondition}
    ${where.split('AND').slice(1).map(cond => `AND ${cond.trim()}`).join('\n    ')}
  GROUP BY time_group, ${hierarchyGroupCols}, ${granularityCols}
),
totals AS (
  SELECT
    time_group,
    ${hierarchyGroupCols},
    SUM(avg_historical_value) as total_value
  FROM historical_values
  GROUP BY time_group, ${hierarchyGroupCols}
)
SELECT
  h.time_group,
  ${granularityCols.split(', ').map(col => `h.${col}`).join(', ')},
  CASE
    WHEN t.total_value = 0 THEN 0
    ELSE h.avg_historical_value / t.total_value
  END as weight
FROM historical_values h
JOIN totals t
  ON h.time_group = t.time_group
  ${hierarchy.editLevel.map(col => `AND h.${col} = t.${col}`).join('\n  ')}
`;
}

/**
 * Weighted allocation: Custom priority weights
 */
function generateWeightedWeightsSQL(
  kpiName: KPIName,
  config: AllocationConfig
): string {
  if (!config.weights) {
    throw new Error('Weights config required for weighted strategy');
  }

  const { time, hierarchy, where } = config.aggregation;
  const { granularity } = config.distribution;
  const { column, mapping } = config.weights;

  const timeMapExpr = time.mapping.sqlExpression;
  const hierarchyGroupCols = hierarchy.editLevel.join(', ');
  const granularityCols = granularity.join(', ');

  // Build CASE statement for weight mapping
  const weightCaseStmt = Object.entries(mapping)
    .map(([value, weight]) => `WHEN ${column} = '${value}' THEN ${weight}`)
    .join('\n    ');

  return `
-- Weighted allocation: custom priority weights
WITH weighted_records AS (
  SELECT
    ${timeMapExpr} as time_group,
    ${hierarchyGroupCols},
    ${granularityCols},
    CASE
      ${weightCaseStmt}
      ELSE 1.0
    END as raw_weight
  FROM kpi_data
  WHERE ${where}
),
totals AS (
  SELECT
    time_group,
    ${hierarchyGroupCols},
    SUM(raw_weight) as total_weight
  FROM weighted_records
  GROUP BY time_group, ${hierarchyGroupCols}
)
SELECT
  w.time_group,
  ${granularityCols.split(', ').map(col => `w.${col}`).join(', ')},
  w.raw_weight / t.total_weight as weight
FROM weighted_records w
JOIN totals t
  ON w.time_group = t.time_group
  ${hierarchy.editLevel.map(col => `AND w.${col} = t.${col}`).join('\n  ')}
`;
}

/**
 * Generate SQL to calculate deltas for each granular record
 */
function generateDeltaCalculationSQL(
  editedValue: number,
  config: AllocationConfig,
  aggregateTable: string,
  weightsTable: string
): string {
  const { granularity } = config.distribution;
  const granularityCols = granularity.join(', ');

  return `
-- Calculate delta for each granular record
SELECT
  ${granularityCols.split(', ').map(col => `w.${col}`).join(', ')},
  (${editedValue} - a.current_value) * w.weight as delta
FROM ${weightsTable} w
CROSS JOIN ${aggregateTable} a
`;
}

/**
 * Generate SQL to apply edits to kpi_data
 */
function generateApplyEditsSQL(
  kpiName: KPIName,
  config: AllocationConfig,
  deltasTable: string
): string {
  const kpiColumn = getKPIColumnName(kpiName);
  const { granularity } = config.distribution;

  // Build WHERE clause to match granular records
  const whereConditions = granularity
    .map(col => `kpi_data.${col} = deltas.${col}`)
    .join('\n  AND ');

  return `
-- Apply distributed edits
ALTER TABLE kpi_data
UPDATE ${kpiColumn} = ${kpiColumn} + (
  SELECT delta
  FROM ${deltasTable} deltas
  WHERE ${whereConditions}
)
WHERE EXISTS (
  SELECT 1
  FROM ${deltasTable} deltas
  WHERE ${whereConditions}
)
`;
}

/**
 * Generate rebalancing steps for dependent KPIs
 */
function generateRebalancingSteps(
  workflowId: string,
  editedKPI: KPIName,
  config: AllocationConfig
): WorkflowStep[] {
  const steps: WorkflowStep[] = [];
  const lockedKPIs = new Set<KPIName>();

  // Get topological sort of dependent KPIs
  const levels = topologicalSort(kpiConfigs, editedKPI, lockedKPIs);

  let previousStepIds = [`${workflowId}_apply_edits`];

  levels.forEach((level, levelIndex) => {
    const levelStepIds: string[] = [];

    level.forEach(kpi => {
      const kpiConfig = kpiConfigs.get(kpi);
      if (!kpiConfig || !kpiConfig.formula) return;

      const stepId = `${workflowId}_rebalance_${kpi.replace(/\s+/g, '_')}_L${levelIndex}`;
      levelStepIds.push(stepId);

      steps.push({
        step_id: stepId,
        description: `Rebalance ${kpi} using formula: ${kpiConfig.formula}`,
        source_table: 'kpi_data',
        target_table: 'kpi_data',
        process_sql: generateFormulaUpdateSQL(kpi, kpiConfig.formula, config),
        cleanup_source: false,
        dependencies: previousStepIds,
      });
    });

    previousStepIds = levelStepIds;
  });

  return steps;
}

/**
 * Generate rebalancing steps for single-product edit
 */
function generateRebalancingStepsForSingleProduct(
  workflowId: string,
  editedKPI: KPIName,
  productId: string,
  week: number,
  year: number
): WorkflowStep[] {
  const steps: WorkflowStep[] = [];
  const lockedKPIs = new Set<KPIName>();

  const levels = topologicalSort(kpiConfigs, editedKPI, lockedKPIs);

  let previousStepIds = [`${workflowId}_apply_edit`];

  levels.forEach((level, levelIndex) => {
    const levelStepIds: string[] = [];

    level.forEach(kpi => {
      const kpiConfig = kpiConfigs.get(kpi);
      if (!kpiConfig || !kpiConfig.formula) return;

      const stepId = `${workflowId}_rebalance_${kpi.replace(/\s+/g, '_')}_L${levelIndex}`;
      levelStepIds.push(stepId);

      steps.push({
        step_id: stepId,
        description: `Rebalance ${kpi} using formula: ${kpiConfig.formula}`,
        source_table: 'kpi_data',
        target_table: 'kpi_data',
        process_sql: generateFormulaUpdateSQLForSingleProduct(
          kpi,
          kpiConfig.formula,
          productId,
          week,
          year
        ),
        cleanup_source: false,
        dependencies: previousStepIds,
      });
    });

    previousStepIds = levelStepIds;
  });

  return steps;
}

/**
 * Generate SQL to update KPI using formula (aggregated edit)
 */
function generateFormulaUpdateSQL(
  kpiName: KPIName,
  formula: string,
  config: AllocationConfig
): string {
  const kpiColumn = getKPIColumnName(kpiName);
  const { where } = config.aggregation;

  // Convert formula to SQL expression
  const sqlExpression = formulaToSQL(formula);

  return `
-- Update ${kpiName} using formula: ${formula}
ALTER TABLE kpi_data
UPDATE ${kpiColumn} = ${sqlExpression}
WHERE ${where}
`;
}

/**
 * Generate SQL to update KPI using formula (single-product edit)
 */
function generateFormulaUpdateSQLForSingleProduct(
  kpiName: KPIName,
  formula: string,
  productId: string,
  week: number,
  year: number
): string {
  const kpiColumn = getKPIColumnName(kpiName);
  const sqlExpression = formulaToSQL(formula);

  return `
-- Update ${kpiName} using formula: ${formula}
ALTER TABLE kpi_data
UPDATE ${kpiColumn} = ${sqlExpression}
WHERE product_id = '${productId}'
  AND year = ${year}
  AND week = ${week}
`;
}

/**
 * Generate time grouping expression based on edit level
 */
function generateTimeGroupExpression(time: TimeAggregation): string {
  switch (time.editLevel) {
    case 'year':
      return 'year';
    case 'quarter':
      return 'toQuarter(toDate(year, 1, 1) + toIntervalWeek(week))';
    case 'month':
      return 'toMonth(toDate(year, 1, 1) + toIntervalWeek(week))';
    case 'week':
      return 'week';
    default:
      throw new Error(`Unknown time edit level: ${time.editLevel}`);
  }
}

/**
 * Convert KPI name to database column name
 */
function getKPIColumnName(kpiName: KPIName): string {
  const columnMap: Record<string, string> = {
    'Sls U': 'sls_u',
    'Sls $': 'sls_d',
    'Rcpt U': 'rcpt_u',
    'Rcpt $': 'rcpt_d',
    'Ret U': 'ret_u',
    'Ret $': 'ret_d',
    'BOP U': 'bop_u',
    'BOP $': 'bop_d',
    'EOP U': 'eop_u',
    'EOP $': 'eop_d',
    'COGS': 'cogs',
    'GM $': 'gm_d',
    'GM%': 'gm_percent',
    'ST%': 'st_percent',
    'DR%': 'dr_percent',
    'WOS': 'wos',
    'Ret Inv U': 'ret_inv_u',
    'Smart Reorder Point': 'smart_reorder_point',
    'Dynamic MD Price': 'dynamic_md_price',
    'Promo Lift %': 'promo_lift_percent',
    'Rec Rcpt U': 'rec_rcpt_u',
  };

  return columnMap[kpiName] || kpiName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

/**
 * Convert formula expression to SQL
 */
function formulaToSQL(formula: string): string {
  let sql = formula;

  // Replace KPI names with column names
  const kpiPattern = /([A-Z][a-z]+ [A-Z$%]|[A-Z][A-Z]+)/g;
  sql = sql.replace(kpiPattern, (match) => {
    return getKPIColumnName(match as KPIName);
  });

  // Replace division with safe division (avoid divide by zero)
  sql = sql.replace(/(\w+)\s*\/\s*(\w+)/g, 'divide($1, $2)');

  return sql;
}
