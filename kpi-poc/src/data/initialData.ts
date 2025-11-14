import type { ProductData, WeekData, KPIName } from '../types';

/**
 * Generates initial sample data for products across multiple weeks
 */
export function generateInitialData(): ProductData {
  const product: ProductData = {
    productId: 'PROD-001',
    productName: 'iPhone Case - Premium',
    weeks: new Map(),
  };

  // Generate data for weeks 8-15 (to show multi-week effects)
  const weeks = [8, 9, 10, 11, 12, 13, 14, 15];

  weeks.forEach(weekNum => {
    const weekData: WeekData = {
      week: weekNum,
      year: 2024,
      values: generateWeekValues(weekNum),
    };

    product.weeks.set(weekNum, weekData);
  });

  return product;
}

/**
 * Generates realistic KPI values for a given week
 */
function generateWeekValues(weekNum: number): Record<KPIName, number> {
  // Base values with some variation by week
  const baseSlsU = 100 + (weekNum - 10) * 5; // Varies around 100
  const auc = 6.0; // Cost per unit
  const aur = 10.0; // Retail price per unit
  const drPercent = 0.2; // 20% discount rate
  const returnPercent = 0.1; // 10% return rate

  // Calculate dependent values
  const slsDollars = baseSlsU * aur;
  const cogs = baseSlsU * auc;
  const returnUnits = returnPercent * baseSlsU;
  const returnDollars = returnUnits * aur;
  const gmDollars = slsDollars - cogs;
  const gmPercent = gmDollars / slsDollars;
  const netSlsU = baseSlsU - returnUnits;
  const netSlsDollars = slsDollars - returnDollars;

  // Inventory values
  const bopUnits = 500 + (weekNum - 10) * 10;
  const bopDollars = bopUnits * auc;
  const totalRcptU = 50;
  const totalRcptDollars = totalRcptU * auc;

  // Return inventory comes from 4 weeks prior
  const returnInv = weekNum >= 12 ? returnUnits * 0.9 : 0; // 10% damage rate

  const eopUnits = bopUnits - baseSlsU + totalRcptU + returnInv;
  const eopDollars = bopDollars - cogs + totalRcptDollars + returnInv * auc;

  return {
    'Sls U': baseSlsU,
    'Sls $': slsDollars,
    'AUR': aur,
    'AUC': auc,
    'DR%': drPercent,
    'Return %': returnPercent,
    'Return U': returnUnits,
    'Return $': returnDollars,
    'COGS': cogs,
    'GM $': gmDollars,
    'GM %': gmPercent,
    'Net Sls U': netSlsU,
    'Net Sls $': netSlsDollars,
    'BOP U': bopUnits,
    'BOP $': bopDollars,
    'EOP U': eopUnits,
    'EOP $': eopDollars,
    'Total Rcpt U': totalRcptU,
    'Total Rcpt $': totalRcptDollars,
    'Return Inv': returnInv,
    'FWOS': bopUnits / baseSlsU, // Simple FWOS calculation
    'Rec Rcpt U': 0,
    'Rec Rcpt $': 0,
  };
}

/**
 * Sample products for demonstration
 */
export const sampleProducts = [
  {
    productId: 'PROD-001',
    productName: 'iPhone Case - Premium',
  },
  {
    productId: 'PROD-002',
    productName: 'Phone Screen Protector',
  },
];

/**
 * Gets display-friendly week labels
 */
export function getWeekLabel(weekNum: number, year: number): string {
  return `W${weekNum} ${year}`;
}

/**
 * Helper to clone product data deeply
 */
export function cloneProductData(data: ProductData): ProductData {
  const cloned: ProductData = {
    ...data,
    weeks: new Map(),
  };

  data.weeks.forEach((week, weekNum) => {
    cloned.weeks.set(weekNum, {
      ...week,
      values: { ...week.values },
    });
  });

  return cloned;
}
