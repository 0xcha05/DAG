// Core types for KPI Rebalancing Engine

export type KPIName =
  | 'Sls U'        // Sales Units
  | 'Sls $'        // Sales Dollars
  | 'AUR'          // Average Unit Retail
  | 'AUC'          // Average Unit Cost
  | 'DR%'          // Discount Rate %
  | 'Return %'     // Return %
  | 'Return U'     // Return Units
  | 'Return $'     // Return Dollars
  | 'COGS'         // Cost of Goods Sold
  | 'GM $'         // Gross Margin $
  | 'GM %'         // Gross Margin %
  | 'Net Sls U'    // Net Sales Units
  | 'Net Sls $'    // Net Sales $
  | 'BOP U'        // Beginning of Period Units
  | 'BOP $'        // Beginning of Period $
  | 'EOP U'        // End of Period Units
  | 'EOP $'        // End of Period $
  | 'Total Rcpt U' // Total Receipts Units
  | 'Total Rcpt $' // Total Receipts $
  | 'Return Inv'   // Return Inventory
  | 'FWOS'         // Forward Weeks of Supply
  | 'Rec Rcpt U'   // Recommended Receipts Units
  | 'Rec Rcpt $'   // Recommended Receipts $
  | 'Smart Reorder Point'  // Smart Reorder Point (Custom Handler)
  | 'Dynamic MD Price'     // Dynamic Markdown Price (Custom Handler)
  | 'Promo Lift %';        // Promotional Lift % (Custom Handler)

export interface KPIValue {
  [key: string]: number;
}

/**
 * Allocation strategy configuration
 */
export type AllocationStrategyType = 'pro_rata' | 'equal' | 'historical' | 'weighted' | 'custom';

export interface AllocationStrategyConfig {
  strategy: AllocationStrategyType;
  historical?: {
    lookbackYears: number;
    sameTimePeriod: boolean;
  };
  weights?: {
    column: string;
    mapping: Record<string, number>;
  };
  customWeightSQL?: string;
}

/**
 * Allocation strategy per aggregation level
 * Supports both simple (one strategy for all) and advanced (per-level)
 */
export interface AllocationStrategy {
  // Simple: One strategy for all cases
  default?: AllocationStrategyConfig;

  // Advanced: Per time aggregation level
  time?: {
    year?: AllocationStrategyConfig;
    quarter?: AllocationStrategyConfig;
    month?: AllocationStrategyConfig;
  };

  // Advanced: Per hierarchy aggregation level
  hierarchy?: {
    [level: string]: AllocationStrategyConfig;  // dept, subdept, category, etc.
  };
}

/**
 * Validation configuration for distribution
 */
export interface AllocationValidation {
  validateSum: boolean;           // Validate that distributed values sum to edited value
  tolerance: number;               // Acceptable difference (e.g., 0.01 for rounding)
  onValidationFailure: 'error' | 'warn' | 'ignore';
}

export interface KPIConfig {
  name: KPIName;
  displayName: string;
  isEditable: boolean;
  formula?: string;
  dependsOn: KPIName[];
  locksWhenEdited: KPIName[];
  description?: string;
  affectsWeeks?: {
    offset: number;
    targetKPI: KPIName;
  }[];
  // Allocation strategy - only for editable KPIs
  allocationStrategy?: AllocationStrategy;
  // Validation config for distribution
  allocationValidation?: AllocationValidation;
}

export interface WeekData {
  week: number;
  year: number;
  values: Record<KPIName, number>;
  lastEdited?: {
    kpi: KPIName;
    timestamp: Date;
  };
}

export interface ProductData {
  productId: string;
  productName: string;
  weeks: Map<number, WeekData>;
}

export interface RebalancingResult {
  updatedWeeks: Map<number, WeekData>;
  affectedKPIs: Set<KPIName>;
  calculationOrder: KPIName[][];
  changes: {
    week: number;
    kpi: KPIName;
    oldValue: number;
    newValue: number;
  }[];
  logs: LogEntry[];
}

export interface DAGNode {
  id: string;
  label: string;
  type: 'editable' | 'calculated' | 'locked';
  formula?: string;
}

export interface DAGEdge {
  source: string;
  target: string;
  label?: string;
}

export type LogEntryType = 'user-edit' | 'system-recalc';

export interface LogEntry {
  id: string;
  timestamp: Date;
  type: LogEntryType;
  kpi: KPIName;
  oldValue: number;
  newValue: number;
  week: number;
  // For system recalculations
  triggeredBy?: KPIName;
  calculationLevel?: number;
  formula?: string;
}
