// Quick test to verify the KPI rebalancing engine
import { KPIRebalancingEngine } from './src/engine/KPIEngine.ts';
import { kpiConfigs } from './src/data/kpiConfig.ts';
import { generateInitialData } from './src/data/initialData.ts';

console.log('=== Testing KPI Rebalancing Engine ===\n');

// Initialize
const engine = new KPIRebalancingEngine(kpiConfigs);
const productData = generateInitialData();

console.log('Initial Data for Week 10:');
const week10 = productData.weeks.get(10);
console.log('Sls U:', week10.values['Sls U']);
console.log('COGS:', week10.values['COGS']);
console.log('GM $:', week10.values['GM $']);
console.log('Return U:', week10.values['Return U']);
console.log('\n---\n');

// Test editing Sls U from 100 to 150
console.log('Editing Sls U from 100 to 150...\n');
const result = engine.rebalance(productData, 10, 'Sls U', 150);

console.log('Rebalancing Result:');
console.log('- Affected KPIs:', Array.from(result.affectedKPIs));
console.log('- Calculation Order:', result.calculationOrder);
console.log('- Changes:', result.changes.length);
console.log('\nChanges:');
result.changes.forEach(change => {
  console.log(`  W${change.week} ${change.kpi}: ${change.oldValue.toFixed(2)} → ${change.newValue.toFixed(2)}`);
});

console.log('\nUpdated Week 10 values:');
const updatedWeek10 = result.updatedWeeks.get(10);
if (updatedWeek10) {
  console.log('Sls U:', updatedWeek10.values['Sls U']);
  console.log('COGS:', updatedWeek10.values['COGS']);
  console.log('GM $:', updatedWeek10.values['GM $']);
  console.log('Return U:', updatedWeek10.values['Return U']);
}
