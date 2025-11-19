/**
 * Workflow Generation Types
 * Defines structure for KPI edit workflows that can be executed by external frameworks
 */

import type { KPIName } from '../types';

/**
 * Workflow step definition
 */
export interface WorkflowStep {
  step_id: string;
  description: string;
  source_table: string;
  target_table: string;
  process_sql: string;
  cleanup_source: boolean;
  dependencies: string[];
}

/**
 * Complete workflow definition
 */
export interface WorkflowDefinition {
  workflow_id: string;
  description: string;
  steps: WorkflowStep[];
  memory_limits: {
    max_memory_mb: number;
    cleanup_threshold_mb: number;
  };
  max_parallel_steps: number;
  timeout_seconds: number;
}

/**
 * Allocation strategy for distributing aggregated edits
 */
export type AllocationStrategy =
  | 'pro_rata'      // Proportional to current values
  | 'equal'         // Distribute equally
  | 'historical'    // Based on historical patterns
  | 'weighted'      // Custom weights
  | 'custom';       // Custom SQL logic

/**
 * Time aggregation configuration
 */
export interface TimeAggregation {
  editLevel: 'year' | 'quarter' | 'month' | 'week';
  storageLevel: 'week';  // Always week for our case
  mapping: {
    // How to map from edit level to storage level
    // e.g., "toStartOfMonth(week_date)" for month → week
    sqlExpression: string;
  };
}

/**
 * Hierarchy aggregation configuration
 */
export interface HierarchyAggregation {
  editLevel: string[];     // e.g., ['dept', 'channel']
  storageLevel: string[];  // e.g., ['product_id', 'hierarchy_code', 'dept', 'channel']
  rollupPath?: string[];   // Optional: hierarchy path for rollup
}

/**
 * Complete allocation configuration
 */
export interface AllocationConfig {
  strategy: AllocationStrategy;

  // What level is the edit at?
  aggregation: {
    time: TimeAggregation;
    hierarchy: HierarchyAggregation;
    where: string;  // Filter clause (e.g., "dept = 'Electronics' AND year = 2024")
  };

  // How to distribute to granular level?
  distribution: {
    granularity: string[];  // Columns at storage level: ['product_id', 'week', 'year']
  };

  // Custom allocation logic (for strategy = 'custom')
  customWeightSQL?: string;

  // Weighted allocation (for strategy = 'weighted')
  weights?: {
    column: string;  // e.g., 'product_tier'
    mapping: Record<string, number>;  // e.g., { 'A': 3.0, 'B': 2.0, 'C': 1.0 }
  };

  // Historical allocation (for strategy = 'historical')
  historical?: {
    lookbackYears: number;  // e.g., 2 (use last 2 years)
    sameTimePeriod: boolean;  // Match same month/quarter/etc.
  };
}

/**
 * Workflow generation context
 */
export interface WorkflowContext {
  editedKPI: KPIName;
  editedValue: number;
  allocationConfig?: AllocationConfig;  // Present if aggregated edit
  productId?: string;  // Present if single-product edit
  week?: number;       // Present if single-week edit
  year?: number;
}
