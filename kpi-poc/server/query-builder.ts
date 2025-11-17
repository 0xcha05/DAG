/**
 * ClickHouse Query Builder
 * Generates SQL queries for KPI operations without executing them
 */

import type { KPIName, LogEntry } from '../src/types';

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
};

/**
 * Generated SQL query with parameters
 */
export interface GeneratedQuery {
  sql: string;
  params: Record<string, string | number>;
  description: string;
}

/**
 * Query builder class
 */
export class KPIQueryBuilder {
  /**
   * Generate query to fetch all product data
   */
  static getProductData(productId: string): GeneratedQuery {
    return {
      sql: `
SELECT *
FROM kpi_data
WHERE product_id = {productId:String}
ORDER BY week ASC
      `.trim(),
      params: {
        productId,
      },
      description: `Fetch all week data for product ${productId}`,
    };
  }

  /**
   * Generate query to fetch specific week data
   */
  static getWeekData(productId: string, week: number): GeneratedQuery {
    return {
      sql: `
SELECT *
FROM kpi_data
WHERE product_id = {productId:String}
  AND week = {week:UInt8}
LIMIT 1
      `.trim(),
      params: {
        productId,
        week,
      },
      description: `Fetch data for product ${productId}, week ${week}`,
    };
  }

  /**
   * Generate query to update a single KPI value
   */
  static updateSingleKPI(
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
      sql: `
ALTER TABLE kpi_data
UPDATE
  ${columnName} = {newValue:Float64},
  last_edited_kpi = {kpiName:String},
  last_edited_timestamp = now(),
  updated_at = now()
WHERE product_id = {productId:String}
  AND week = {week:UInt8}
      `.trim(),
      params: {
        productId,
        week,
        kpiName,
        newValue,
      },
      description: `Update ${kpiName} to ${newValue} for product ${productId}, week ${week}`,
    };
  }

  /**
   * Generate query to update multiple KPIs at once
   */
  static updateMultipleKPIs(
    productId: string,
    week: number,
    values: Partial<Record<KPIName, number>>
  ): GeneratedQuery {
    const setClauses: string[] = ['updated_at = now()'];
    const params: Record<string, string | number> = {
      productId,
      week,
    };

    Object.entries(values).forEach(([kpiName, value], index) => {
      const columnName = KPI_COLUMN_MAP[kpiName];
      if (columnName && value !== undefined) {
        const paramName = `value${index}`;
        setClauses.push(`${columnName} = {${paramName}:Float64}`);
        params[paramName] = value;
      }
    });

    if (setClauses.length === 1) {
      throw new Error('No KPI values provided for update');
    }

    const kpiList = Object.keys(values).join(', ');

    return {
      sql: `
ALTER TABLE kpi_data
UPDATE ${setClauses.join(',\n       ')}
WHERE product_id = {productId:String}
  AND week = {week:UInt8}
      `.trim(),
      params,
      description: `Update ${Object.keys(values).length} KPIs (${kpiList}) for product ${productId}, week ${week}`,
    };
  }

  /**
   * Generate query to log a user edit
   */
  static logUserEdit(
    entry: LogEntry,
    productId: string,
    year: number
  ): GeneratedQuery {
    return {
      sql: `
INSERT INTO kpi_audit_log (
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
)
      `.trim(),
      params: {
        productId,
        week: entry.week,
        year,
        kpiName: entry.kpi,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
      },
      description: `Log user edit: ${entry.kpi} changed from ${entry.oldValue} → ${entry.newValue}`,
    };
  }

  /**
   * Generate query to log a system recalculation
   */
  static logSystemRecalc(
    entry: LogEntry,
    productId: string,
    year: number
  ): GeneratedQuery {
    return {
      sql: `
INSERT INTO kpi_audit_log (
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
)
      `.trim(),
      params: {
        productId,
        week: entry.week,
        year,
        kpiName: entry.kpi,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
        triggeredBy: entry.triggeredBy || '',
        calculationLevel: entry.calculationLevel || 0,
        formula: entry.formula || '',
      },
      description: `Log system recalc: ${entry.kpi} changed from ${entry.oldValue} → ${entry.newValue} (triggered by ${entry.triggeredBy}, level ${entry.calculationLevel})`,
    };
  }

  /**
   * Generate query to get audit logs for a product
   */
  static getAuditLogs(
    productId: string,
    startWeek?: number,
    endWeek?: number,
    limit: number = 100
  ): GeneratedQuery {
    let whereClause = 'product_id = {productId:String}';
    const params: Record<string, string | number> = { productId, limit };

    if (startWeek !== undefined) {
      whereClause += ' AND week >= {startWeek:UInt8}';
      params.startWeek = startWeek;
    }

    if (endWeek !== undefined) {
      whereClause += ' AND week <= {endWeek:UInt8}';
      params.endWeek = endWeek;
    }

    return {
      sql: `
SELECT *
FROM kpi_audit_log
WHERE ${whereClause}
ORDER BY timestamp DESC
LIMIT {limit:UInt32}
      `.trim(),
      params,
      description: `Fetch audit logs for product ${productId}${startWeek ? ` (weeks ${startWeek}-${endWeek || 'latest'})` : ''}`,
    };
  }

  /**
   * Generate query to get KPI configuration
   */
  static getKPIConfig(kpiName?: KPIName): GeneratedQuery {
    if (kpiName) {
      return {
        sql: `
SELECT *
FROM kpi_config
WHERE kpi_name = {kpiName:String}
LIMIT 1
        `.trim(),
        params: { kpiName },
        description: `Fetch configuration for KPI: ${kpiName}`,
      };
    }

    return {
      sql: `
SELECT *
FROM kpi_config
ORDER BY is_editable DESC, kpi_name ASC
      `.trim(),
      params: {},
      description: 'Fetch all KPI configurations',
    };
  }

  /**
   * Generate query to update KPI configuration
   */
  static updateKPIConfig(
    kpiName: KPIName,
    updates: {
      formula?: string;
      dependsOn?: string[];
      locksWhenEdited?: string[];
    }
  ): GeneratedQuery {
    const setClauses: string[] = ['updated_at = now()', 'version = version + 1'];
    const params: Record<string, string | number> = { kpiName };

    if (updates.formula !== undefined) {
      setClauses.push('formula = {formula:String}');
      params.formula = updates.formula;
    }

    if (updates.dependsOn !== undefined) {
      setClauses.push('depends_on = {dependsOn:String}');
      params.dependsOn = JSON.stringify(updates.dependsOn);
    }

    if (updates.locksWhenEdited !== undefined) {
      setClauses.push('locks_when_edited = {locksWhenEdited:String}');
      params.locksWhenEdited = JSON.stringify(updates.locksWhenEdited);
    }

    return {
      sql: `
ALTER TABLE kpi_config
UPDATE ${setClauses.join(',\n       ')}
WHERE kpi_name = {kpiName:String}
      `.trim(),
      params,
      description: `Update configuration for KPI: ${kpiName}`,
    };
  }

  /**
   * Generate batch update queries for rebalancing scenario
   * Example: User edits Sls U, triggers recalc of COGS, GM $, GM %, etc.
   */
  static generateRebalancingQueries(
    productId: string,
    week: number,
    year: number,
    editedKPI: KPIName,
    editedValue: number,
    recalculatedValues: Array<{
      kpi: KPIName;
      oldValue: number;
      newValue: number;
      triggeredBy: KPIName;
      calculationLevel: number;
      formula: string;
    }>
  ): GeneratedQuery[] {
    const queries: GeneratedQuery[] = [];

    // 1. Log the user edit
    queries.push(
      this.logUserEdit(
        {
          id: `user-edit-${Date.now()}`,
          timestamp: new Date(),
          type: 'user-edit',
          kpi: editedKPI,
          oldValue: 0, // Would come from current value
          newValue: editedValue,
          week,
        },
        productId,
        year
      )
    );

    // 2. Update the edited KPI
    queries.push(
      this.updateSingleKPI(productId, week, editedKPI, editedValue)
    );

    // 3. Update each recalculated KPI
    recalculatedValues.forEach(recalc => {
      // Log system recalc
      queries.push(
        this.logSystemRecalc(
          {
            id: `system-recalc-${Date.now()}-${recalc.kpi}`,
            timestamp: new Date(),
            type: 'system-recalc',
            kpi: recalc.kpi,
            oldValue: recalc.oldValue,
            newValue: recalc.newValue,
            week,
            triggeredBy: recalc.triggeredBy,
            calculationLevel: recalc.calculationLevel,
            formula: recalc.formula,
          },
          productId,
          year
        )
      );

      // Update KPI value
      queries.push(
        this.updateSingleKPI(productId, week, recalc.kpi, recalc.newValue)
      );
    });

    return queries;
  }
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
  return queries.map((q, i) => `-- Query ${i + 1}/${queries.length}\n${formatQuery(q)}`).join('\n\n');
}
