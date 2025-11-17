/**
 * Service to generate ClickHouse queries from in-memory operations
 * Bridges the gap between the KPIEngine (in-memory) and ClickHouse SQL generation
 */

import type { KPIName, LogEntry, RebalancingResult } from '../types';
import { hasCustomHandler, getCustomHandlerSQL } from '../engine/customKPIHandlers';

/**
 * Generated SQL query with parameters
 */
export interface GeneratedQuery {
  sql: string;
  params: Record<string, string | number>;
  description: string;
}

/**
 * KPI column mapping from TypeScript names to ClickHouse column names
 */
const KPI_COLUMN_MAP: Record<string, string> = {
  'Sls U': 'sls_u',
  'Sls $': 'sls_dollars',
  'AUR': 'aur',
  'AUC': 'auc',
  'DR%': 'dr_percent',
  'Return %': 'return_percent',
  'Return U': 'return_u',
  'Return $': 'return_dollars',
  'COGS': 'cogs',
  'GM $': 'gm_dollars',
  'GM %': 'gm_percent',
  'Net Sls U': 'net_sls_u',
  'Net Sls $': 'net_sls_dollars',
  'BOP U': 'bop_u',
  'BOP $': 'bop_dollars',
  'EOP U': 'eop_u',
  'EOP $': 'eop_dollars',
  'Total Rcpt U': 'total_rcpt_u',
  'Total Rcpt $': 'total_rcpt_dollars',
  'Return Inv': 'return_inv',
  'FWOS': 'fwos',
  'Rec Rcpt U': 'rec_rcpt_u',
  'Rec Rcpt $': 'rec_rcpt_dollars',
  'Smart Reorder Point': 'smart_reorder_point',
  'Dynamic MD Price': 'dynamic_md_price',
  'Promo Lift %': 'promo_lift_percent',
};

/**
 * Generate ClickHouse queries from a rebalancing result
 */
export function generateRebalancingQueries(
  productId: string,
  year: number,
  result: RebalancingResult,
  editedKPI: KPIName,
  editedWeek: number,
  editedValue: number
): GeneratedQuery[] {
  const queries: GeneratedQuery[] = [];

  // 1. Log the user edit
  const userEditLog = result.logs.find(
    log => log.type === 'user-edit' && log.kpi === editedKPI && log.week === editedWeek
  );

  if (userEditLog) {
    queries.push(generateLogUserEditQuery(userEditLog, productId, year));
  }

  // 2. Update the edited KPI
  queries.push(generateUpdateSingleKPIQuery(productId, editedWeek, editedKPI, editedValue));

  // 3. Update each recalculated KPI and log it
  const systemLogs = result.logs.filter(log => log.type === 'system-recalc');

  systemLogs.forEach(log => {
    // Log system recalc
    queries.push(generateLogSystemRecalcQuery(log, productId, year));

    // If this is a custom handler, add explanation before the update
    if (hasCustomHandler(log.kpi)) {
      const explanation = generateCustomHandlerExplanation(log.kpi, productId, log.week);
      if (explanation) {
        queries.push(explanation);
      }
    }

    // Update KPI value
    queries.push(generateUpdateSingleKPIQuery(productId, log.week, log.kpi, log.newValue));
  });

  return queries;
}

/**
 * Generate query to update a single KPI value
 */
function generateUpdateSingleKPIQuery(
  productId: string,
  week: number,
  kpiName: KPIName,
  newValue: number
): GeneratedQuery {
  const columnName = KPI_COLUMN_MAP[kpiName];
  if (!columnName) {
    throw new Error(`Unknown KPI: ${kpiName}`);
  }

  return {
    sql: `ALTER TABLE kpi_data
UPDATE
  ${columnName} = {newValue:Float64},
  last_edited_kpi = {kpiName:String},
  last_edited_timestamp = now(),
  updated_at = now()
WHERE product_id = {productId:String}
  AND week = {week:UInt8}`,
    params: {
      productId,
      week,
      kpiName,
      newValue: parseFloat(newValue.toFixed(4)),
    },
    description: `Update ${kpiName} to ${newValue.toFixed(2)} (Week ${week})`,
  };
}

/**
 * Generate query to log a user edit
 */
function generateLogUserEditQuery(
  entry: LogEntry,
  productId: string,
  year: number
): GeneratedQuery {
  return {
    sql: `INSERT INTO kpi_audit_log (
  id, timestamp, log_type, product_id, week, year,
  kpi_name, old_value, new_value, user_id
) VALUES (
  generateUUIDv4(),
  now(),
  'user-edit',
  {productId:String},
  {week:UInt8},
  {year:UInt16},
  {kpiName:String},
  {oldValue:Float64},
  {newValue:Float64},
  NULL
)`,
    params: {
      productId,
      week: entry.week,
      year,
      kpiName: entry.kpi,
      oldValue: parseFloat(entry.oldValue.toFixed(4)),
      newValue: parseFloat(entry.newValue.toFixed(4)),
    },
    description: `Log user edit: ${entry.kpi} (${entry.oldValue.toFixed(2)} → ${entry.newValue.toFixed(2)})`,
  };
}

/**
 * Generate query to log a system recalculation
 */
function generateLogSystemRecalcQuery(
  entry: LogEntry,
  productId: string,
  year: number
): GeneratedQuery {
  // Check if this is a custom handler
  const isCustom = entry.formula?.startsWith('[Custom Handler:');
  const formulaDisplay = isCustom
    ? entry.formula
    : entry.formula || '';

  return {
    sql: `INSERT INTO kpi_audit_log (
  id, timestamp, log_type, product_id, week, year,
  kpi_name, old_value, new_value,
  triggered_by, calculation_level, formula
) VALUES (
  generateUUIDv4(),
  now(),
  'system-recalc',
  {productId:String},
  {week:UInt8},
  {year:UInt16},
  {kpiName:String},
  {oldValue:Float64},
  {newValue:Float64},
  {triggeredBy:String},
  {calculationLevel:UInt8},
  {formula:String}
)`,
    params: {
      productId,
      week: entry.week,
      year,
      kpiName: entry.kpi,
      oldValue: parseFloat(entry.oldValue.toFixed(4)),
      newValue: parseFloat(entry.newValue.toFixed(4)),
      triggeredBy: entry.triggeredBy || '',
      calculationLevel: entry.calculationLevel || 0,
      formula: formulaDisplay,
    },
    description: `Log system recalc: ${entry.kpi} (Level ${entry.calculationLevel}, triggered by ${entry.triggeredBy})${isCustom ? ' [CUSTOM HANDLER]' : ''}`,
  };
}

/**
 * Generate additional SQL explanation for custom KPI handlers
 */
function generateCustomHandlerExplanation(
  kpiName: KPIName,
  productId: string,
  week: number
): GeneratedQuery | null {
  if (!hasCustomHandler(kpiName)) {
    return null;
  }

  const sqlInfo = getCustomHandlerSQL(kpiName, productId, week);

  return {
    sql: `-- CUSTOM HANDLER EXPLANATION: ${kpiName}
-- This KPI cannot be calculated with a simple formula
-- ${sqlInfo.description}
--
-- Implementation requires ${sqlInfo.requiresMultiQuery ? 'MULTIPLE QUERIES' : 'COMPLEX LOGIC'}:
${sqlInfo.steps.map((step, i) => `-- Step ${i + 1}: ${step}`).join('\n')}
--
-- The final UPDATE query (below) sets the calculated value,
-- but the actual calculation logic is implemented in application code.`,
    params: {
      productId,
      week,
      kpiName,
    },
    description: `Custom Handler Explanation: ${kpiName}`,
  };
}

/**
 * Format a query for display (pretty print)
 */
export function formatQuery(query: GeneratedQuery): string {
  let formatted = `-- ${query.description}\n`;
  formatted += query.sql;
  formatted += '\n\n-- Parameters:\n';
  Object.entries(query.params).forEach(([key, value]) => {
    formatted += `-- ${key} = ${typeof value === 'string' ? `'${value}'` : value}\n`;
  });
  return formatted;
}

/**
 * Format multiple queries as a batch
 */
export function formatQueryBatch(queries: GeneratedQuery[]): string {
  return queries
    .map((q, i) => `-- Query ${i + 1}/${queries.length}\n${formatQuery(q)}`)
    .join('\n\n');
}
