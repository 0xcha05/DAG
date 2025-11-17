/**
 * Example Queries for KPI Rebalancing Engine
 * Demonstrates what SQL queries would be generated for common operations
 */

import { KPIQueryBuilder, formatQuery, formatQueryBatch } from '../server/query-builder';
import type { KPIName } from '../src/types';

console.log('='.repeat(80));
console.log('KPI REBALANCING ENGINE - QUERY GENERATION EXAMPLES');
console.log('='.repeat(80));
console.log();

// =============================================================================
// Example 1: Fetch Product Data
// =============================================================================

console.log('EXAMPLE 1: Fetch all data for a product');
console.log('-'.repeat(80));
const fetchQuery = KPIQueryBuilder.getProductData('PROD-001');
console.log(formatQuery(fetchQuery));
console.log();

// =============================================================================
// Example 2: Fetch Specific Week
// =============================================================================

console.log('EXAMPLE 2: Fetch data for a specific week');
console.log('-'.repeat(80));
const weekQuery = KPIQueryBuilder.getWeekData('PROD-001', 10);
console.log(formatQuery(weekQuery));
console.log();

// =============================================================================
// Example 3: Simple User Edit
// =============================================================================

console.log('EXAMPLE 3: User edits a single KPI');
console.log('-'.repeat(80));
const editQuery = KPIQueryBuilder.updateSingleKPI(
  'PROD-001',
  10,
  'Sls U' as KPIName,
  1200
);
console.log(formatQuery(editQuery));
console.log();

// =============================================================================
// Example 4: Update Multiple KPIs (Batch Recalculation)
// =============================================================================

console.log('EXAMPLE 4: Update multiple KPIs at once (batch recalculation)');
console.log('-'.repeat(80));
const batchQuery = KPIQueryBuilder.updateMultipleKPIs('PROD-001', 10, {
  'COGS': 7200,
  'GM $': 4800,
  'GM %': 0.4,
  'Return U': 12,
});
console.log(formatQuery(batchQuery));
console.log();

// =============================================================================
// Example 5: Full Rebalancing Scenario
// =============================================================================

console.log('EXAMPLE 5: Full rebalancing scenario - User edits Sls U from 1000 → 1200');
console.log('-'.repeat(80));
console.log();

const rebalancingQueries = KPIQueryBuilder.generateRebalancingQueries(
  'PROD-001',
  10,
  2024,
  'Sls U' as KPIName,
  1200,
  [
    {
      kpi: 'COGS' as KPIName,
      oldValue: 6000,
      newValue: 7200,
      triggeredBy: 'Sls U' as KPIName,
      calculationLevel: 1,
      formula: 'Sls U * AUC',
    },
    {
      kpi: 'AUR' as KPIName,
      oldValue: 10,
      newValue: 10,
      triggeredBy: 'Sls U' as KPIName,
      calculationLevel: 1,
      formula: 'Sls $ / Sls U',
    },
    {
      kpi: 'GM $' as KPIName,
      oldValue: 4000,
      newValue: 4800,
      triggeredBy: 'Sls U' as KPIName,
      calculationLevel: 2,
      formula: 'Sls $ - COGS',
    },
    {
      kpi: 'GM %' as KPIName,
      oldValue: 0.4,
      newValue: 0.4,
      triggeredBy: 'Sls U' as KPIName,
      calculationLevel: 3,
      formula: 'GM $ / Sls $',
    },
    {
      kpi: 'Return U' as KPIName,
      oldValue: 10,
      newValue: 12,
      triggeredBy: 'Sls U' as KPIName,
      calculationLevel: 1,
      formula: 'Return % * Sls U',
    },
    {
      kpi: 'EOP U' as KPIName,
      oldValue: 440,
      newValue: 238,
      triggeredBy: 'Sls U' as KPIName,
      calculationLevel: 2,
      formula: 'BOP U - Sls U + Total Rcpt U + Return Inv',
    },
  ]
);

console.log(formatQueryBatch(rebalancingQueries));
console.log();

console.log('Total queries generated:', rebalancingQueries.length);
console.log();

// =============================================================================
// Example 6: Multi-Week Effect (EOP → BOP Propagation)
// =============================================================================

console.log('EXAMPLE 6: Multi-week effect - EOP from Week 10 becomes BOP for Week 11');
console.log('-'.repeat(80));
console.log();

// Step 1: Update Week 10 EOP
const eopUpdateQuery = KPIQueryBuilder.updateSingleKPI(
  'PROD-001',
  10,
  'EOP U' as KPIName,
  238
);
console.log('-- Step 1: Update Week 10 EOP U');
console.log(formatQuery(eopUpdateQuery));
console.log();

// Step 2: Update Week 11 BOP with Week 10 EOP value
const bopUpdateQuery = KPIQueryBuilder.updateSingleKPI(
  'PROD-001',
  11,
  'BOP U' as KPIName,
  238
);
console.log('-- Step 2: Update Week 11 BOP U with Week 10 EOP value');
console.log(formatQuery(bopUpdateQuery));
console.log();

// =============================================================================
// Example 7: Return Inventory 4-Week Delay
// =============================================================================

console.log('EXAMPLE 7: Return inventory - Week 10 returns affect Week 14 inventory');
console.log('-'.repeat(80));
console.log();

// Week 10: Return U changes
const returnUpdateQuery = KPIQueryBuilder.updateSingleKPI(
  'PROD-001',
  10,
  'Return U' as KPIName,
  15
);
console.log('-- Step 1: Update Week 10 Return U');
console.log(formatQuery(returnUpdateQuery));
console.log();

// Week 14: Return Inv = Week 10 Return U * 0.9 (10% damage)
const returnInvUpdateQuery = KPIQueryBuilder.updateSingleKPI(
  'PROD-001',
  14,
  'Return Inv' as KPIName,
  13.5  // 15 * 0.9
);
console.log('-- Step 2: Update Week 14 Return Inv (15 * 0.9 = 13.5)');
console.log(formatQuery(returnInvUpdateQuery));
console.log();

// =============================================================================
// Example 8: Query Audit Logs
// =============================================================================

console.log('EXAMPLE 8: Query audit logs for a product and week range');
console.log('-'.repeat(80));
const logsQuery = KPIQueryBuilder.getAuditLogs('PROD-001', 10, 12, 50);
console.log(formatQuery(logsQuery));
console.log();

// =============================================================================
// Example 9: Get KPI Configuration
// =============================================================================

console.log('EXAMPLE 9: Fetch KPI configuration');
console.log('-'.repeat(80));
console.log();

console.log('-- Get all configurations:');
const allConfigQuery = KPIQueryBuilder.getKPIConfig();
console.log(formatQuery(allConfigQuery));
console.log();

console.log('-- Get specific KPI configuration:');
const singleConfigQuery = KPIQueryBuilder.getKPIConfig('COGS' as KPIName);
console.log(formatQuery(singleConfigQuery));
console.log();

// =============================================================================
// Example 10: Update KPI Configuration (Dynamic Formula Change)
// =============================================================================

console.log('EXAMPLE 10: Update KPI configuration - Change COGS formula');
console.log('-'.repeat(80));
const configUpdateQuery = KPIQueryBuilder.updateKPIConfig('COGS' as KPIName, {
  formula: 'Sls U * AUC * 1.05',  // Add 5% overhead
  dependsOn: ['Sls U', 'AUC'],
});
console.log(formatQuery(configUpdateQuery));
console.log();

// =============================================================================
// Summary
// =============================================================================

console.log('='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log();
console.log('These examples demonstrate:');
console.log('1. Basic CRUD operations (fetch, update)');
console.log('2. Single and batch updates');
console.log('3. Full rebalancing scenarios with cascading calculations');
console.log('4. Multi-week effects (EOP→BOP, Return Inventory)');
console.log('5. Audit logging (user edits vs system recalcs)');
console.log('6. Dynamic configuration management');
console.log();
console.log('All queries are GENERATED but NOT EXECUTED.');
console.log('This allows you to:');
console.log('- Review query structure before execution');
console.log('- Debug query generation logic');
console.log('- Understand data flow and dependencies');
console.log('- Optimize queries before deployment');
console.log();
console.log('='.repeat(80));
