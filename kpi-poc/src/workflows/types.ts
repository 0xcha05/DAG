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
 * Time dimension aggregation
 * Describes how time is aggregated from storage level to edit level
 */
export interface TimeAggregation {
  level: TimeAggregationLevel;  // What level user is editing at
  sqlExpression: string;         // SQL to map from storage (week) to edit level
}

/**
 * Hierarchy dimension aggregation
 * Describes how hierarchy is aggregated from storage level to edit level
 */
export interface HierarchyAggregation {
  level: HierarchyAggregationLevel;  // What level user is editing at (e.g., 'dept')
  levels: string[];                   // All hierarchy columns at this level (e.g., ['dept'])
}

/**
 * Aggregation context - describes at what level the edit is being made
 *
 * This tells the system:
 * - WHERE: Which aggregation level is the user editing at?
 * - WHAT: Which records match the edit?
 * - TARGET: Which granular records to distribute to?
 */
export interface AggregationContext {
  // Time dimension (optional - if editing by time)
  time?: TimeAggregation;

  // Hierarchy dimension (optional - if editing by hierarchy)
  hierarchy?: HierarchyAggregation;

  // Filter: Which records to include
  where: string;  // e.g., "dept = 'Electronics' AND year = 2024"

  // Target: Where to distribute to (storage granularity)
  granularity: string[];  // e.g., ['product_id', 'week', 'year']
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
