import { createClient, ClickHouseClient } from '@clickhouse/client';

/**
 * ClickHouse connection configuration
 */
interface ClickHouseConfig {
  host: string;
  port?: number;
  database: string;
  username?: string;
  password?: string;
}

/**
 * Get ClickHouse configuration from environment variables
 */
function getConfig(): ClickHouseConfig {
  return {
    host: process.env.CLICKHOUSE_HOST || 'localhost',
    port: process.env.CLICKHOUSE_PORT ? parseInt(process.env.CLICKHOUSE_PORT) : 8123,
    database: process.env.CLICKHOUSE_DATABASE || 'kpi_engine',
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
  };
}

/**
 * Singleton ClickHouse client instance
 */
let clickhouseClient: ClickHouseClient | null = null;

/**
 * Initialize and return ClickHouse client
 */
export function getClickHouseClient(): ClickHouseClient {
  if (!clickhouseClient) {
    const config = getConfig();

    clickhouseClient = createClient({
      host: `http://${config.host}:${config.port}`,
      database: config.database,
      username: config.username,
      password: config.password,
      compression: {
        response: true,
        request: true,
      },
      clickhouse_settings: {
        // Optimize for OLAP queries
        max_threads: 4,
        enable_http_compression: 1,
      },
    });

    console.log(`✓ Connected to ClickHouse at ${config.host}:${config.port}/${config.database}`);
  }

  return clickhouseClient;
}

/**
 * Close ClickHouse client connection
 */
export async function closeClickHouseClient(): Promise<void> {
  if (clickhouseClient) {
    await clickhouseClient.close();
    clickhouseClient = null;
    console.log('✓ ClickHouse connection closed');
  }
}

/**
 * Test ClickHouse connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    const client = getClickHouseClient();
    const result = await client.query({
      query: 'SELECT 1 as test',
      format: 'JSONEachRow',
    });

    const data = await result.json<{ test: number }>();
    return data.length > 0 && data[0].test === 1;
  } catch (error) {
    console.error('ClickHouse connection test failed:', error);
    return false;
  }
}

/**
 * Verify that required tables exist
 */
export async function verifySchema(): Promise<boolean> {
  try {
    const client = getClickHouseClient();

    const result = await client.query({
      query: `
        SELECT name
        FROM system.tables
        WHERE database = '${getConfig().database}'
        AND name IN ('kpi_data', 'kpi_audit_log')
      `,
      format: 'JSONEachRow',
    });

    const tables = await result.json<{ name: string }>();
    const tableNames = tables.map(t => t.name);

    const hasKpiData = tableNames.includes('kpi_data');
    const hasAuditLog = tableNames.includes('kpi_audit_log');

    if (!hasKpiData || !hasAuditLog) {
      console.error('Missing required tables. Please run schema.sql first.');
      console.error('Found tables:', tableNames);
      return false;
    }

    console.log('✓ Schema verification passed');
    return true;
  } catch (error) {
    console.error('Schema verification failed:', error);
    return false;
  }
}
