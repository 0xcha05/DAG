/**
 * Workflow Generator for KPI Edits (Version 2)
 *
 * Generates executable workflow definitions using KPI-specific allocation strategies.
 * The allocation strategy comes from the KPI config, not from the workflow context.
 */

import type { KPIName, AllocationStrategyConfig, AllocationValidation } from '../types';
import type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowContext,
  AggregationContext,
} from './types';
import { topologicalSort } from '../engine/topologicalSort';
import { kpiConfigs } from '../data/kpiConfig';

/**
 * Get allocation strategy for a KPI based on aggregation level
 */
function getAllocationStrategy(
  kpiName: KPIName,
  aggContext?: AggregationContext
): AllocationStrategyConfig | null {
  const kpiConfig = kpiConfigs.find(config => config.name === kpiName);
  if (!kpiConfig || !kpiConfig.allocationStrategy) {
    return null;
  }

  const strategy = kpiConfig.allocationStrategy;

  // Check for time-specific strategy
  if (aggContext?.time && strategy.time) {
    const timeLevel = aggContext.time.level;
    if (strategy.time[timeLevel]) {
      return strategy.time[timeLevel]!;
    }
  }

  // Check for hierarchy-specific strategy
  if (aggContext?.hierarchy && strategy.hierarchy) {
    const hierarchyLevel = aggContext.hierarchy.level;
    if (strategy.hierarchy[hierarchyLevel]) {
      return strategy.hierarchy[hierarchyLevel]!;
    }
  }

  // Fall back to default strategy
  if (strategy.default) {
    return strategy.default;
  }

  return null;
}

/**
 * Get validation config for a KPI
 */
function getValidationConfig(kpiName: KPIName): AllocationValidation | null {
  const kpiConfig = kpiConfigs.find(config => config.name === kpiName);
  return kpiConfig?.allocationValidation || null;
}

/**
 * Generate complete workflow for aggregated edit with allocation
 */
export function generateAggregatedEditWorkflow(
  context: WorkflowContext
): WorkflowDefinition {
  if (!context.aggregationContext) {
    throw new Error('Aggregation context required for aggregated edits');
  }

  const { editedKPI, editedValue, aggregationContext } = context;

  // Get allocation strategy from KPI config
  const strategyConfig = getAllocationStrategy(editedKPI, aggregationContext);
  if (!strategyConfig) {
    throw new Error(`No allocation strategy defined for ${editedKPI}`);
  }

  const workflowId = `edit_${editedKPI.replace(/\s+/g, '_')}_${Date.now()}`;
  const steps: WorkflowStep[] = [];

  // Step 1: Calculate current aggregate value
  steps.push({
    step_id: `${workflowId}_calculate_current`,
    description: 'Calculate current aggregate value before edit',
    source_table: 'kpi_data',
    target_table: `tmp_${workflowId}_current_aggregate`,
    process_sql: generateAggregateQuerySQL(editedKPI, aggregationContext),
    cleanup_source: false,
    dependencies: [],
  });

  // Step 2: Calculate allocation weights based on KPI's strategy
  steps.push({
    step_id: `${workflowId}_calculate_weights`,
    description: `Calculate allocation weights using ${strategyConfig.strategy} strategy`,
    source_table: 'kpi_data',
    target_table: `tmp_${workflowId}_weights`,
    process_sql: generateAllocationWeightsSQL(editedKPI, strategyConfig, aggregationContext),
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
      editedValue,
      aggregationContext,
      `tmp_${workflowId}_current_aggregate`,
      `tmp_${workflowId}_weights`
    ),
    cleanup_source: true,
    dependencies: [`${workflowId}_calculate_current`, `${workflowId}_calculate_weights`],
  });

  // Step 4: Apply edits to granular level
  steps.push({
    step_id: `${workflowId}_apply_edits`,
    description: `Apply distributed edits to ${editedKPI}`,
    source_table: `tmp_${workflowId}_deltas`,
    target_table: 'kpi_data',
    process_sql: generateApplyEditsSQL(
      editedKPI,
      aggregationContext,
      `tmp_${workflowId}_deltas`
    ),
    cleanup_source: true,
    dependencies: [`${workflowId}_calculate_deltas`],
  });

  // Step 5: Validation (optional)
  const validationConfig = getValidationConfig(editedKPI);
  if (validationConfig && validationConfig.validateSum) {
    steps.push({
      step_id: `${workflowId}_validate`,
      description: 'Validate distributed sum equals edited value',
      source_table: 'kpi_data',
      target_table: `tmp_${workflowId}_validation`,
      process_sql: generateValidationSQL(
        editedKPI,
        editedValue,
        aggregationContext,
        validationConfig
      ),
      cleanup_source: true,
      dependencies: [`${workflowId}_apply_edits`],
    });
  }

  // Step 6+: Rebalance dependent KPIs
  const rebalanceSteps = generateRebalancingSteps(
    workflowId,
    editedKPI,
    aggregationContext,
    validationConfig?.validateSum ? [`${workflowId}_validate`] : [`${workflowId}_apply_edits`]
  );
  steps.push(...rebalanceSteps);

  return {
    workflow_id: workflowId,
    description: `Edit ${editedKPI} at aggregated level and rebalance dependent KPIs`,
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
 */
export function generateSingleProductEditWorkflow(
  context: WorkflowContext
): WorkflowDefinition {
  if (!context.productId || !context.week || !context.year) {
    throw new Error('Product ID, week, and year required for single-product edits');
  }

  const { editedKPI, editedValue, productId, week, year } = context;
  const workflowId = `edit_${editedKPI.replace(/\s+/g, '_')}_${Date.now()}`;
  const steps: WorkflowStep[] = [];

  // Step 1: Apply direct edit
  steps.push({
    step_id: `${workflowId}_apply_edit`,
    description: `Update ${editedKPI} for product ${productId}`,
    source_table: 'kpi_data',
    target_table: 'kpi_data',
    process_sql: `
ALTER TABLE kpi_data
UPDATE ${getKPIColumnName(editedKPI)} = ${editedValue}
WHERE product_id = '${productId}'
  AND year = ${year}
  AND week = ${week}
`,
    cleanup_source: false,
    dependencies: [],
  });

  // Step 2+: Rebalance dependent KPIs
  const rebalanceSteps = generateRebalancingStepsForSingleProduct(
    workflowId,
    editedKPI,
    productId,
    week,
    year
  );
  steps.push(...rebalanceSteps);

  return {
    workflow_id: workflowId,
    description: `Edit ${editedKPI} for single product and rebalance`,
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
  aggContext: AggregationContext
): string {
  const kpiColumn = getKPIColumnName(kpiName);
  const { time, hierarchy, where } = aggContext;

  // Build time grouping expression
  const timeGroupExpr = time ? time.sqlExpression : 'NULL';

  // Build hierarchy grouping columns
  const hierarchyGroupCols = hierarchy ? hierarchy.levels.join(', ') : '1';

  return `
-- Calculate current aggregate value
SELECT
  ${timeGroupExpr} as time_group,
  ${hierarchyGroupCols}${hierarchy ? ',' : ''}
  SUM(${kpiColumn}) as current_value
FROM kpi_data
WHERE ${where}
GROUP BY time_group${hierarchy ? ', ' + hierarchyGroupCols : ''}
`;
}

/**
 * Generate SQL to calculate allocation weights based on strategy
 */
function generateAllocationWeightsSQL(
  kpiName: KPIName,
  strategyConfig: AllocationStrategyConfig,
  aggContext: AggregationContext
): string {
  const { strategy } = strategyConfig;

  switch (strategy) {
    case 'pro_rata':
      return generateProRataWeightsSQL(kpiName, aggContext);
    case 'equal':
      return generateEqualWeightsSQL(kpiName, aggContext);
    case 'historical':
      return generateHistoricalWeightsSQL(kpiName, strategyConfig, aggContext);
    case 'weighted':
      return generateWeightedWeightsSQL(kpiName, strategyConfig, aggContext);
    case 'custom':
      return strategyConfig.customWeightSQL || 'SELECT 1 as weight';
    default:
      throw new Error(`Unknown allocation strategy: ${strategy}`);
  }
}

/**
 * Pro-rata allocation: Distribute proportionally to current values
 */
function generateProRataWeightsSQL(
  kpiName: KPIName,
  aggContext: AggregationContext
): string {
  const kpiColumn = getKPIColumnName(kpiName);
  const { time, hierarchy, where, granularity } = aggContext;

  const timeMapExpr = time ? time.sqlExpression : 'NULL';
  const hierarchyGroupCols = hierarchy ? hierarchy.levels.join(', ') : '';
  const granularityCols = granularity.join(', ');

  return `
-- Pro-rata weights: proportional to current values
WITH granular_values AS (
  SELECT
    ${timeMapExpr} as time_group,
    ${hierarchyGroupCols}${hierarchyGroupCols ? ',' : ''}
    ${granularityCols},
    ${kpiColumn} as current_value
  FROM kpi_data
  WHERE ${where}
),
totals AS (
  SELECT
    time_group,
    ${hierarchyGroupCols}${hierarchyGroupCols ? ',' : ''}
    SUM(current_value) as total_value
  FROM granular_values
  GROUP BY time_group${hierarchyGroupCols ? ', ' + hierarchyGroupCols : ''}
)
SELECT
  ${granularityCols.split(', ').map(col => `g.${col}`).join(', ')},
  CASE
    WHEN t.total_value = 0 THEN 0
    ELSE g.current_value / t.total_value
  END as weight
FROM granular_values g
JOIN totals t
  ON g.time_group = t.time_group
  ${hierarchy ? hierarchy.levels.map(col => `AND g.${col} = t.${col}`).join('\n  ') : ''}
`;
}

/**
 * Equal allocation: Distribute evenly across all granular records
 */
function generateEqualWeightsSQL(
  kpiName: KPIName,
  aggContext: AggregationContext
): string {
  const { time, hierarchy, where, granularity } = aggContext;

  const timeMapExpr = time ? time.sqlExpression : 'NULL';
  const hierarchyGroupCols = hierarchy ? hierarchy.levels.join(', ') : '';
  const granularityCols = granularity.join(', ');

  return `
-- Equal weights: distribute evenly
WITH granular_records AS (
  SELECT
    ${timeMapExpr} as time_group,
    ${hierarchyGroupCols}${hierarchyGroupCols ? ',' : ''}
    ${granularityCols}
  FROM kpi_data
  WHERE ${where}
),
counts AS (
  SELECT
    time_group,
    ${hierarchyGroupCols}${hierarchyGroupCols ? ',' : ''}
    COUNT(*) as record_count
  FROM granular_records
  GROUP BY time_group${hierarchyGroupCols ? ', ' + hierarchyGroupCols : ''}
)
SELECT
  ${granularityCols.split(', ').map(col => `g.${col}`).join(', ')},
  1.0 / c.record_count as weight
FROM granular_records g
JOIN counts c
  ON g.time_group = c.time_group
  ${hierarchy ? hierarchy.levels.map(col => `AND g.${col} = c.${col}`).join('\n  ') : ''}
`;
}

/**
 * Historical allocation: Based on historical patterns
 */
function generateHistoricalWeightsSQL(
  kpiName: KPIName,
  strategyConfig: AllocationStrategyConfig,
  aggContext: AggregationContext
): string {
  if (!strategyConfig.historical) {
    throw new Error('Historical config required for historical strategy');
  }

  const kpiColumn = getKPIColumnName(kpiName);
  const { time, hierarchy, where, granularity } = aggContext;
  const { lookbackYears, sameTimePeriod } = strategyConfig.historical;

  const timeMapExpr = time ? time.sqlExpression : 'NULL';
  const hierarchyGroupCols = hierarchy ? hierarchy.levels.join(', ') : '';
  const granularityCols = granularity.join(', ');

  // Extract year from where clause for lookback calculation
  const yearMatch = where.match(/year\s*=\s*(\d+)/);
  const currentYear = yearMatch ? parseInt(yearMatch[1]) : 2024;
  const lookbackYearStart = currentYear - lookbackYears;

  const timePeriodCondition = sameTimePeriod && time
    ? `AND ${timeMapExpr} = (SELECT ${timeMapExpr} FROM kpi_data WHERE ${where} LIMIT 1)`
    : '';

  return `
-- Historical weights: based on past ${lookbackYears} years
WITH historical_values AS (
  SELECT
    ${timeMapExpr} as time_group,
    ${hierarchyGroupCols}${hierarchyGroupCols ? ',' : ''}
    ${granularityCols},
    AVG(${kpiColumn}) as avg_historical_value
  FROM kpi_data
  WHERE year >= ${lookbackYearStart} AND year < ${currentYear}
    ${timePeriodCondition}
  GROUP BY time_group, ${hierarchyGroupCols}${hierarchyGroupCols ? ', ' : ''}${granularityCols}
),
totals AS (
  SELECT
    time_group,
    ${hierarchyGroupCols}${hierarchyGroupCols ? ',' : ''}
    SUM(avg_historical_value) as total_value
  FROM historical_values
  GROUP BY time_group${hierarchyGroupCols ? ', ' + hierarchyGroupCols : ''}
)
SELECT
  ${granularityCols.split(', ').map(col => `h.${col}`).join(', ')},
  CASE
    WHEN t.total_value = 0 THEN 0
    ELSE h.avg_historical_value / t.total_value
  END as weight
FROM historical_values h
JOIN totals t
  ON h.time_group = t.time_group
  ${hierarchy ? hierarchy.levels.map(col => `AND h.${col} = t.${col}`).join('\n  ') : ''}
`;
}

/**
 * Weighted allocation: Custom priority weights
 */
function generateWeightedWeightsSQL(
  kpiName: KPIName,
  strategyConfig: AllocationStrategyConfig,
  aggContext: AggregationContext
): string {
  if (!strategyConfig.weights) {
    throw new Error('Weights config required for weighted strategy');
  }

  const { time, hierarchy, where, granularity } = aggContext;
  const { column, mapping } = strategyConfig.weights;

  const timeMapExpr = time ? time.sqlExpression : 'NULL';
  const hierarchyGroupCols = hierarchy ? hierarchy.levels.join(', ') : '';
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
    ${hierarchyGroupCols}${hierarchyGroupCols ? ',' : ''}
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
    ${hierarchyGroupCols}${hierarchyGroupCols ? ',' : ''}
    SUM(raw_weight) as total_weight
  FROM weighted_records
  GROUP BY time_group${hierarchyGroupCols ? ', ' + hierarchyGroupCols : ''}
)
SELECT
  ${granularityCols.split(', ').map(col => `w.${col}`).join(', ')},
  w.raw_weight / t.total_weight as weight
FROM weighted_records w
JOIN totals t
  ON w.time_group = t.time_group
  ${hierarchy ? hierarchy.levels.map(col => `AND w.${col} = t.${col}`).join('\n  ') : ''}
`;
}

/**
 * Generate SQL to calculate deltas for each granular record
 */
function generateDeltaCalculationSQL(
  editedValue: number,
  aggContext: AggregationContext,
  aggregateTable: string,
  weightsTable: string
): string {
  const { granularity } = aggContext;
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
  aggContext: AggregationContext,
  deltasTable: string
): string {
  const kpiColumn = getKPIColumnName(kpiName);
  const { granularity } = aggContext;

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
 * Generate validation SQL
 */
function generateValidationSQL(
  kpiName: KPIName,
  editedValue: number,
  aggContext: AggregationContext,
  validationConfig: AllocationValidation
): string {
  const kpiColumn = getKPIColumnName(kpiName);
  const { where } = aggContext;
  const { tolerance, onValidationFailure } = validationConfig;

  const failureAction = onValidationFailure === 'error'
    ? 'THROW'
    : onValidationFailure === 'warn'
    ? 'WARN'
    : 'IGNORE';

  return `
-- Validate distribution sum
WITH validation AS (
  SELECT
    SUM(${kpiColumn}) as actual_sum,
    ${editedValue} as expected_sum,
    ABS(SUM(${kpiColumn}) - ${editedValue}) as difference
  FROM kpi_data
  WHERE ${where}
)
SELECT
  *,
  CASE
    WHEN difference > ${tolerance} THEN '${failureAction}: Sum mismatch by ' || toString(difference)
    ELSE 'OK'
  END as validation_result
FROM validation
`;
}

/**
 * Generate rebalancing steps for dependent KPIs
 */
function generateRebalancingSteps(
  workflowId: string,
  editedKPI: KPIName,
  aggContext: AggregationContext,
  previousStepIds: string[]
): WorkflowStep[] {
  const steps: WorkflowStep[] = [];
  const lockedKPIs = new Set<KPIName>();

  // Get topological sort of dependent KPIs
  const configsMap = new Map(kpiConfigs.map(c => [c.name, c]));
  const levels = topologicalSort(configsMap, editedKPI, lockedKPIs);

  let currentDeps = previousStepIds;

  levels.forEach((level, levelIndex) => {
    const levelStepIds: string[] = [];

    level.forEach(kpi => {
      const kpiConfig = kpiConfigs.find(c => c.name === kpi);
      if (!kpiConfig || !kpiConfig.formula) return;

      const stepId = `${workflowId}_rebalance_${kpi.replace(/\s+/g, '_')}_L${levelIndex}`;
      levelStepIds.push(stepId);

      steps.push({
        step_id: stepId,
        description: `Rebalance ${kpi} using formula: ${kpiConfig.formula}`,
        source_table: 'kpi_data',
        target_table: 'kpi_data',
        process_sql: generateFormulaUpdateSQL(kpi, kpiConfig.formula, aggContext),
        cleanup_source: false,
        dependencies: currentDeps,
      });
    });

    currentDeps = levelStepIds;
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

  const configsMap = new Map(kpiConfigs.map(c => [c.name, c]));
  const levels = topologicalSort(configsMap, editedKPI, lockedKPIs);

  let previousStepIds = [`${workflowId}_apply_edit`];

  levels.forEach((level, levelIndex) => {
    const levelStepIds: string[] = [];

    level.forEach(kpi => {
      const kpiConfig = kpiConfigs.find(c => c.name === kpi);
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
  aggContext: AggregationContext
): string {
  const kpiColumn = getKPIColumnName(kpiName);
  const { where } = aggContext;

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
    'Return U': 'return_u',
    'Return $': 'return_d',
    'Return %': 'return_percent',
    'AUR': 'aur',
    'AUC': 'auc',
    'Net Sls U': 'net_sls_u',
    'Net Sls $': 'net_sls_d',
    'Total Rcpt U': 'total_rcpt_u',
    'Total Rcpt $': 'total_rcpt_d',
    'Return Inv': 'return_inv',
    'FWOS': 'fwos',
    'Rec Rcpt $': 'rec_rcpt_d',
  };

  return columnMap[kpiName] || kpiName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

/**
 * Convert formula expression to SQL
 */
function formulaToSQL(formula: string): string {
  let sql = formula;

  // Replace KPI names with column names
  const kpiPattern = /([A-Z][a-z]+ [A-Z$%]|[A-Z][A-Z]+|[A-Z][a-z]+)/g;
  sql = sql.replace(kpiPattern, (match) => {
    try {
      return getKPIColumnName(match as KPIName);
    } catch {
      return match;
    }
  });

  // Replace division with safe division (avoid divide by zero)
  sql = sql.replace(/(\w+)\s*\/\s*(\w+)/g, 'divide($1, $2)');

  return sql;
}
