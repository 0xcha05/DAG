import { getClickHouseClient } from './clickhouse.js';
import type { KPIName, WeekData, ProductData, LogEntry } from '../../src/types';

/**
 * Data Access Layer for KPI operations
 */

/**
 * KPI column mapping from TypeScript names to ClickHouse column names
 */
const KPI_COLUMN_MAP: Record<KPIName, string> = {
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
 * Reverse map: ClickHouse column names to TypeScript KPI names
 */
const COLUMN_KPI_MAP: Record<string, KPIName> = Object.fromEntries(
  Object.entries(KPI_COLUMN_MAP).map(([kpi, col]) => [col, kpi as KPIName])
) as Record<string, KPIName>;

/**
 * ClickHouse row structure
 */
interface ClickHouseRow {
  product_id: string;
  product_name: string;
  week: number;
  year: number;
  [key: string]: number | string | null;
}

/**
 * Convert ClickHouse row to WeekData
 */
function rowToWeekData(row: ClickHouseRow): WeekData {
  const values: Record<KPIName, number> = {} as Record<KPIName, number>;

  // Map all KPI columns
  Object.entries(KPI_COLUMN_MAP).forEach(([kpiName, columnName]) => {
    values[kpiName as KPIName] = (row[columnName] as number) || 0;
  });

  return {
    week: row.week,
    year: row.year,
    values,
    lastEdited: row.last_edited_kpi
      ? {
          kpi: COLUMN_KPI_MAP[row.last_edited_kpi] || (row.last_edited_kpi as KPIName),
          timestamp: new Date(row.last_edited_timestamp as string),
        }
      : undefined,
  };
}

/**
 * Get product data for all weeks
 */
export async function getProductData(productId: string): Promise<ProductData | null> {
  const client = getClickHouseClient();

  try {
    const result = await client.query({
      query: `
        SELECT *
        FROM kpi_data
        WHERE product_id = {productId:String}
        ORDER BY week ASC
      `,
      query_params: {
        productId,
      },
      format: 'JSONEachRow',
    });

    const rows = await result.json<ClickHouseRow>();

    if (rows.length === 0) {
      return null;
    }

    const weeks = new Map<number, WeekData>();
    rows.forEach(row => {
      const weekData = rowToWeekData(row);
      weeks.set(row.week, weekData);
    });

    return {
      productId: rows[0].product_id,
      productName: rows[0].product_name,
      weeks,
    };
  } catch (error) {
    console.error('Error fetching product data:', error);
    throw error;
  }
}

/**
 * Get week data for a specific week
 */
export async function getWeekData(productId: string, week: number): Promise<WeekData | null> {
  const client = getClickHouseClient();

  try {
    const result = await client.query({
      query: `
        SELECT *
        FROM kpi_data
        WHERE product_id = {productId:String}
        AND week = {week:UInt8}
        LIMIT 1
      `,
      query_params: {
        productId,
        week,
      },
      format: 'JSONEachRow',
    });

    const rows = await result.json<ClickHouseRow>();

    if (rows.length === 0) {
      return null;
    }

    return rowToWeekData(rows[0]);
  } catch (error) {
    console.error('Error fetching week data:', error);
    throw error;
  }
}

/**
 * Update a single KPI value
 */
export async function updateKPIValue(
  productId: string,
  week: number,
  kpiName: KPIName,
  newValue: number
): Promise<void> {
  const client = getClickHouseClient();
  const columnName = KPI_COLUMN_MAP[kpiName];

  if (!columnName) {
    throw new Error(`Unknown KPI: ${kpiName}`);
  }

  try {
    await client.command({
      query: `
        ALTER TABLE kpi_data
        UPDATE
          ${columnName} = {newValue:Float64},
          last_edited_kpi = {kpiName:String},
          last_edited_timestamp = now(),
          updated_at = now()
        WHERE product_id = {productId:String}
        AND week = {week:UInt8}
      `,
      query_params: {
        productId,
        week,
        kpiName,
        newValue,
      },
    });

    console.log(`✓ Updated ${kpiName} to ${newValue} for product ${productId} week ${week}`);
  } catch (error) {
    console.error('Error updating KPI value:', error);
    throw error;
  }
}

/**
 * Update multiple KPI values for a week
 */
export async function updateWeekValues(
  productId: string,
  week: number,
  values: Partial<Record<KPIName, number>>
): Promise<void> {
  const client = getClickHouseClient();

  // Build SET clause
  const setClauses: string[] = ['updated_at = now()'];
  const params: Record<string, string | number> = {
    productId,
    week,
  };

  Object.entries(values).forEach(([kpiName, value], index) => {
    const columnName = KPI_COLUMN_MAP[kpiName as KPIName];
    if (columnName && value !== undefined) {
      const paramName = `value${index}`;
      setClauses.push(`${columnName} = {${paramName}:Float64}`);
      params[paramName] = value;
    }
  });

  if (setClauses.length === 1) {
    // No values to update
    return;
  }

  try {
    await client.command({
      query: `
        ALTER TABLE kpi_data
        UPDATE ${setClauses.join(', ')}
        WHERE product_id = {productId:String}
        AND week = {week:UInt8}
      `,
      query_params: params,
    });

    console.log(`✓ Updated ${Object.keys(values).length} KPIs for product ${productId} week ${week}`);
  } catch (error) {
    console.error('Error updating week values:', error);
    throw error;
  }
}

/**
 * Log a KPI change to audit log
 */
export async function logKPIChange(entry: LogEntry, productId: string, year: number): Promise<void> {
  const client = getClickHouseClient();

  try {
    await client.insert({
      table: 'kpi_audit_log',
      values: [
        {
          id: entry.id,
          timestamp: entry.timestamp.toISOString(),
          log_type: entry.type === 'user-edit' ? 1 : 2,
          product_id: productId,
          week: entry.week,
          year,
          kpi_name: entry.kpi,
          old_value: entry.oldValue,
          new_value: entry.newValue,
          triggered_by: entry.triggeredBy || null,
          calculation_level: entry.calculationLevel || null,
          formula: entry.formula || null,
          user_id: null, // TODO: Add user tracking
        },
      ],
      format: 'JSONEachRow',
    });

    console.log(`✓ Logged ${entry.type} for ${entry.kpi}`);
  } catch (error) {
    console.error('Error logging KPI change:', error);
    throw error;
  }
}

/**
 * Get audit logs for a product and time range
 */
export async function getAuditLogs(
  productId: string,
  startWeek?: number,
  endWeek?: number,
  limit: number = 100
): Promise<LogEntry[]> {
  const client = getClickHouseClient();

  let whereClause = `product_id = {productId:String}`;
  const params: Record<string, string | number> = { productId };

  if (startWeek !== undefined) {
    whereClause += ` AND week >= {startWeek:UInt8}`;
    params.startWeek = startWeek;
  }

  if (endWeek !== undefined) {
    whereClause += ` AND week <= {endWeek:UInt8}`;
    params.endWeek = endWeek;
  }

  try {
    const result = await client.query({
      query: `
        SELECT *
        FROM kpi_audit_log
        WHERE ${whereClause}
        ORDER BY timestamp DESC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        ...params,
        limit,
      },
      format: 'JSONEachRow',
    });

    const rows = await result.json<{
      id: string;
      timestamp: string;
      log_type: number;
      kpi_name: string;
      old_value: number;
      new_value: number;
      week: number;
      triggered_by: string | null;
      calculation_level: number | null;
      formula: string | null;
    }>();

    return rows.map(row => ({
      id: row.id,
      timestamp: new Date(row.timestamp),
      type: row.log_type === 1 ? 'user-edit' : 'system-recalc',
      kpi: row.kpi_name as KPIName,
      oldValue: row.old_value,
      newValue: row.new_value,
      week: row.week,
      triggeredBy: row.triggered_by ? (row.triggered_by as KPIName) : undefined,
      calculationLevel: row.calculation_level || undefined,
      formula: row.formula || undefined,
    }));
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    throw error;
  }
}

/**
 * Get list of all products
 */
export async function getAllProducts(): Promise<{ productId: string; productName: string }[]> {
  const client = getClickHouseClient();

  try {
    const result = await client.query({
      query: `
        SELECT DISTINCT product_id, product_name
        FROM kpi_data
        ORDER BY product_id
      `,
      format: 'JSONEachRow',
    });

    const rows = await result.json<{ product_id: string; product_name: string }>();
    return rows.map(row => ({
      productId: row.product_id,
      productName: row.product_name,
    }));
  } catch (error) {
    console.error('Error fetching products:', error);
    throw error;
  }
}
