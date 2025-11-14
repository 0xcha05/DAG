// Simple test to verify KPI rebalancing works
// Run with: node test-rebalancing.mjs

console.log('=== KPI Rebalancing Engine Test ===\n');

// Simulate initial data
const initialValues = {
  'Sls U': 100,
  'Sls $': 1000,
  'AUR': 10,          // 1000 / 100 = 10
  'AUC': 6,
  'DR%': 0.2,
  'Return %': 0.1,
  'Return U': 10,     // 10% of 100
  'Return $': 100,
  'COGS': 600,        // 100 * 6
  'GM $': 400,        // 1000 - 600
  'GM %': 0.4,        // 400 / 1000
  'Net Sls U': 90,    // 100 - 10
  'Net Sls $': 900,   // 1000 - 100
  'BOP U': 500,
  'BOP $': 3000,
  'EOP U': 450,
  'EOP $': 2700,
  'Total Rcpt U': 50,
  'Total Rcpt $': 300,
  'Return Inv': 0,
  'FWOS': 5,
  'Rec Rcpt U': 0,
  'Rec Rcpt $': 0,
};

console.log('Initial State (Week 10):');
console.log('  Sls U:', initialValues['Sls U']);
console.log('  Sls $:', initialValues['Sls $']);
console.log('  AUR:', initialValues['AUR']);
console.log('  COGS:', initialValues['COGS']);
console.log('  Return U:', initialValues['Return U']);
console.log('  GM $:', initialValues['GM $']);
console.log('  GM %:', initialValues['GM %']);
console.log('');

// Simulate editing Sls U from 100 to 150
const newSlsU = 150;
const existingAUR = initialValues['AUR']; // Should stay at 10

console.log(`Editing Sls U from ${initialValues['Sls U']} to ${newSlsU}...`);
console.log('');

// Recalculate
const newValues = { ...initialValues };
newValues['Sls U'] = newSlsU;
newValues['Sls $'] = newSlsU * existingAUR; // 150 * 10 = 1500
newValues['AUR'] = newValues['Sls $'] / newValues['Sls U']; // Should still be 10
newValues['COGS'] = newValues['Sls U'] * newValues['AUC']; // 150 * 6 = 900
newValues['Return U'] = newValues['Return %'] * newValues['Sls U']; // 0.1 * 150 = 15
newValues['Return $'] = newValues['Return U'] * newValues['AUR']; // 15 * 10 = 150
newValues['GM $'] = newValues['Sls $'] - newValues['COGS']; // 1500 - 900 = 600
newValues['GM %'] = newValues['GM $'] / newValues['Sls $']; // 600 / 1500 = 0.4
newValues['Net Sls U'] = newValues['Sls U'] - newValues['Return U']; // 150 - 15 = 135
newValues['Net Sls $'] = newValues['Sls $'] - newValues['Return $']; // 1500 - 150 = 1350

console.log('Expected Results:');
console.log('  Sls U:', newValues['Sls U'], '(changed)');
console.log('  Sls $:', newValues['Sls $'], '(recalculated: 150 * 10 = 1500)');
console.log('  AUR:', newValues['AUR'], '(stays same: 1500 / 150 = 10)');
console.log('  COGS:', newValues['COGS'], '(recalculated: 150 * 6 = 900)');
console.log('  Return U:', newValues['Return U'], '(recalculated: 0.1 * 150 = 15)');
console.log('  Return $:', newValues['Return $'], '(recalculated: 15 * 10 = 150)');
console.log('  GM $:', newValues['GM $'], '(recalculated: 1500 - 900 = 600)');
console.log('  GM %:', newValues['GM %'], '(stays same: 600 / 1500 = 0.4)');
console.log('  Net Sls U:', newValues['Net Sls U'], '(recalculated: 150 - 15 = 135)');
console.log('  Net Sls $:', newValues['Net Sls $'], '(recalculated: 1500 - 150 = 1350)');
console.log('');

console.log('Key Observations:');
console.log('  ✓ AUR stays constant at 10 (price doesn\'t change)');
console.log('  ✓ Sls $ increased proportionally');
console.log('  ✓ COGS increased (more units * cost)');
console.log('  ✓ GM $ increased (more revenue - more cost)');
console.log('  ✓ GM % stayed the same (margin percentage unchanged)');
console.log('  ✓ Return U increased (more sales = more returns)');
console.log('');
console.log('This is what the engine should do! ✨');
