import { KPIConfig, KPIName } from '../types';

/**
 * KPI Configuration based on Sls U (Sales Units) editing scenario
 *
 * When Sls U is edited:
 * - Lock: DR% and Return %
 * - Recalculate all dependent KPIs based on formulas
 */
export const kpiConfigs: KPIConfig[] = [
  // ============= EDITABLE KPIs =============

  {
    name: 'Sls U',
    displayName: 'Sales Units',
    isEditable: true,
    dependsOn: [],
    locksWhenEdited: ['DR%', 'Return %'],
    description: 'Total units sold in the period',
  },

  {
    name: 'Sls $',
    displayName: 'Sales Dollars',
    isEditable: true,
    dependsOn: [],
    locksWhenEdited: ['Sls U'],
    description: 'Total sales revenue',
  },

  {
    name: 'DR%',
    displayName: 'Discount Rate %',
    isEditable: true,
    dependsOn: [],
    locksWhenEdited: ['Sls U'],
    description: 'Percentage discount applied to sales',
  },

  {
    name: 'Return %',
    displayName: 'Return Rate %',
    isEditable: true,
    dependsOn: [],
    locksWhenEdited: ['Sls U'],
    description: 'Percentage of units returned',
  },

  // ============= CALCULATED KPIs (Level 1 - Direct dependencies) =============

  {
    name: 'AUR',
    displayName: 'Average Unit Retail',
    isEditable: false,
    formula: 'Sls $ / Sls U',
    dependsOn: ['Sls $', 'Sls U'],
    locksWhenEdited: [],
    description: 'Average selling price per unit',
  },

  {
    name: 'COGS',
    displayName: 'Cost of Goods Sold',
    isEditable: false,
    formula: 'Sls U * AUC',
    dependsOn: ['Sls U', 'AUC'],
    locksWhenEdited: [],
    description: 'Total cost of units sold',
  },

  {
    name: 'Return U',
    displayName: 'Return Units',
    isEditable: false,
    formula: 'Return % * Sls U',
    dependsOn: ['Return %', 'Sls U'],
    locksWhenEdited: [],
    description: 'Number of units returned',
    affectsWeeks: [
      {
        offset: 4,
        targetKPI: 'Return Inv',
      },
    ],
  },

  // ============= CALCULATED KPIs (Level 2 - Depend on Level 1) =============

  {
    name: 'GM $',
    displayName: 'Gross Margin $',
    isEditable: false,
    formula: 'Sls $ - COGS',
    dependsOn: ['Sls $', 'COGS'],
    locksWhenEdited: [],
    description: 'Gross profit in dollars',
  },

  {
    name: 'Return $',
    displayName: 'Return Dollars',
    isEditable: false,
    formula: 'Return U * AUR',
    dependsOn: ['Return U', 'AUR'],
    locksWhenEdited: [],
    description: 'Dollar value of returns',
  },

  {
    name: 'Net Sls U',
    displayName: 'Net Sales Units',
    isEditable: false,
    formula: 'Sls U - Return U',
    dependsOn: ['Sls U', 'Return U'],
    locksWhenEdited: [],
    description: 'Net units after returns',
  },

  // ============= CALCULATED KPIs (Level 3 - Depend on Level 2) =============

  {
    name: 'GM %',
    displayName: 'Gross Margin %',
    isEditable: false,
    formula: 'GM $ / Sls $',
    dependsOn: ['GM $', 'Sls $'],
    locksWhenEdited: [],
    description: 'Gross margin percentage',
  },

  {
    name: 'Net Sls $',
    displayName: 'Net Sales $',
    isEditable: false,
    formula: 'Sls $ - Return $',
    dependsOn: ['Sls $', 'Return $'],
    locksWhenEdited: [],
    description: 'Net revenue after returns',
  },

  // ============= INVENTORY KPIs =============

  {
    name: 'BOP U',
    displayName: 'Beginning of Period Units',
    isEditable: true,
    dependsOn: [],
    locksWhenEdited: [],
    description: 'Inventory at start of period',
  },

  {
    name: 'BOP $',
    displayName: 'Beginning of Period $',
    isEditable: true,
    dependsOn: [],
    locksWhenEdited: [],
    description: 'Inventory value at start of period',
  },

  {
    name: 'Total Rcpt U',
    displayName: 'Total Receipts Units',
    isEditable: true,
    dependsOn: [],
    locksWhenEdited: [],
    description: 'Units received in period',
  },

  {
    name: 'Total Rcpt $',
    displayName: 'Total Receipts $',
    isEditable: true,
    dependsOn: [],
    locksWhenEdited: [],
    description: 'Dollar value of receipts',
  },

  {
    name: 'Return Inv',
    displayName: 'Return Inventory',
    isEditable: false,
    dependsOn: [],
    locksWhenEdited: [],
    description: 'Inventory from returns (4 weeks prior)',
  },

  {
    name: 'EOP U',
    displayName: 'End of Period Units',
    isEditable: false,
    formula: 'BOP U - Sls U + Total Rcpt U + Return Inv',
    dependsOn: ['BOP U', 'Sls U', 'Total Rcpt U', 'Return Inv'],
    locksWhenEdited: [],
    description: 'Inventory at end of period',
  },

  {
    name: 'EOP $',
    displayName: 'End of Period $',
    isEditable: false,
    formula: 'BOP $ - COGS + Total Rcpt $ + (Return Inv * AUC)',
    dependsOn: ['BOP $', 'COGS', 'Total Rcpt $', 'Return Inv', 'AUC'],
    locksWhenEdited: [],
    description: 'Inventory value at end of period',
  },

  // ============= CONSTANTS/INPUTS =============

  {
    name: 'AUC',
    displayName: 'Average Unit Cost',
    isEditable: true,
    dependsOn: [],
    locksWhenEdited: [],
    description: 'Average cost per unit',
  },

  // ============= ADVANCED KPIs =============

  {
    name: 'FWOS',
    displayName: 'Forward Weeks of Supply',
    isEditable: false,
    dependsOn: ['BOP U', 'Sls U'],
    locksWhenEdited: [],
    description: 'Weeks of inventory on hand',
  },

  {
    name: 'Rec Rcpt U',
    displayName: 'Recommended Receipts Units',
    isEditable: false,
    dependsOn: ['FWOS', 'BOP U', 'Sls U'],
    locksWhenEdited: [],
    description: 'Recommended order quantity',
  },

  {
    name: 'Rec Rcpt $',
    displayName: 'Recommended Receipts $',
    isEditable: false,
    formula: 'Rec Rcpt U * AUC',
    dependsOn: ['Rec Rcpt U', 'AUC'],
    locksWhenEdited: [],
    description: 'Dollar value of recommended order',
  },
];

/**
 * Helper function to get config by KPI name
 */
export function getKPIConfig(kpiName: KPIName): KPIConfig | undefined {
  return kpiConfigs.find(c => c.name === kpiName);
}

/**
 * Helper function to get all editable KPIs
 */
export function getEditableKPIs(): KPIConfig[] {
  return kpiConfigs.filter(c => c.isEditable);
}

/**
 * Helper function to get all calculated KPIs
 */
export function getCalculatedKPIs(): KPIConfig[] {
  return kpiConfigs.filter(c => !c.isEditable && c.formula);
}
