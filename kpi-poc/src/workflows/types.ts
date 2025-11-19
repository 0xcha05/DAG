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
 * Time aggregation level for the edit
 */
export type TimeAggregationLevel = 'year' | 'quarter' | 'month' | 'week';

/**
 * Hierarchy aggregation level for the edit
 */
export type HierarchyAggregationLevel = string;  // 'dept', 'subdept', 'category', etc.

/**
 * Aggregation context - describes at what level the edit is being made
 */
export interface AggregationContext {
  // Time dimension
  time?: {
    level: TimeAggregationLevel;
    sqlExpression: string;  // How to map weeks to this level
  };

  // Hierarchy dimension
  hierarchy?: {
    level: HierarchyAggregationLevel;  // e.g., 'dept', 'subdept'
    levels: string[];  // All hierarchy columns: ['dept', 'subdept', 'category']
  };

  // Where clause for filtering
  where: string;  // e.g., "dept = 'Electronics' AND year = 2024"

  // Distribution granularity (target level)
  granularity: string[];  // ['product_id', 'week', 'year']
}

/**
 * Workflow generation context
 */
export interface WorkflowContext {
  editedKPI: KPIName;
  editedValue: number;

  // For aggregated edits
  aggregationContext?: AggregationContext;

  // For single-product edits
  productId?: string;
  week?: number;
  year?: number;
}
