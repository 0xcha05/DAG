import type { KPIConfig, KPIName } from '../types';
import { hasCustomHandler } from './customKPIHandlers';

/**
 * Performs topological sort on KPI dependencies using Kahn's algorithm.
 * Returns levels of KPIs that can be calculated in parallel.
 *
 * @param configs - KPI configurations with dependencies
 * @param editedKPI - The KPI that was edited (starting point)
 * @param lockedKPIs - KPIs that should not be recalculated
 * @returns Array of levels, where each level contains KPIs that can be calculated in parallel
 */
export function topologicalSort(
  configs: Map<KPIName, KPIConfig>,
  editedKPI: KPIName,
  lockedKPIs: Set<KPIName>
): KPIName[][] {
  // Build dependency graph and in-degree map
  const graph = new Map<KPIName, Set<KPIName>>();
  const inDegree = new Map<KPIName, number>();
  const calculableKPIs = new Set<KPIName>();

  // Initialize graph
  configs.forEach((config, kpi) => {
    // Skip KPIs that have neither formula nor custom handler
    if (!config.formula && !hasCustomHandler(kpi)) return;
    if (lockedKPIs.has(kpi)) return; // Skip locked KPIs
    if (kpi === editedKPI) return; // Skip the edited KPI itself

    calculableKPIs.add(kpi);
    inDegree.set(kpi, 0);
    graph.set(kpi, new Set());
  });

  // Build edges and calculate in-degrees
  calculableKPIs.forEach(kpi => {
    const config = configs.get(kpi)!;

    config.dependsOn.forEach(dependency => {
      if (!graph.has(dependency)) {
        graph.set(dependency, new Set());
      }

      graph.get(dependency)!.add(kpi);

      // Only increment in-degree if dependency is also calculable
      // If dependency is editable/locked, its value is already available
      if (calculableKPIs.has(dependency)) {
        inDegree.set(kpi, (inDegree.get(kpi) || 0) + 1);
      }
    });
  });

  // Find nodes with no dependencies (can be calculated first)
  const queue: KPIName[] = [];
  calculableKPIs.forEach(kpi => {
    if (inDegree.get(kpi) === 0) {
      queue.push(kpi);
    }
  });

  // Process level by level
  const levels: KPIName[][] = [];

  while (queue.length > 0) {
    const currentLevel: KPIName[] = [...queue];
    queue.length = 0;

    // Process all nodes in current level
    currentLevel.forEach(node => {
      const dependents = graph.get(node);

      if (dependents) {
        dependents.forEach(dependent => {
          const newInDegree = (inDegree.get(dependent) || 0) - 1;
          inDegree.set(dependent, newInDegree);

          if (newInDegree === 0) {
            queue.push(dependent);
          }
        });
      }
    });

    if (currentLevel.length > 0) {
      levels.push(currentLevel);
    }
  }

  // Check for cycles (should not happen in a well-configured system)
  const processedCount = levels.flat().length;
  if (processedCount < calculableKPIs.size) {
    console.warn(
      `Cycle detected in KPI dependencies! Processed ${processedCount} of ${calculableKPIs.size} KPIs`
    );
  }

  return levels;
}

/**
 * Gets all KPIs that depend on the given KPI (directly or indirectly)
 */
export function getDependentKPIs(
  configs: Map<KPIName, KPIConfig>,
  sourceKPI: KPIName
): Set<KPIName> {
  const dependents = new Set<KPIName>();
  const queue: KPIName[] = [sourceKPI];
  const visited = new Set<KPIName>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    configs.forEach((config, kpi) => {
      if (config.dependsOn.includes(current) && !visited.has(kpi)) {
        dependents.add(kpi);
        queue.push(kpi);
      }
    });
  }

  return dependents;
}

/**
 * Validates that there are no cycles in the dependency graph
 */
export function validateNoCycles(configs: Map<KPIName, KPIConfig>): boolean {
  const visited = new Set<KPIName>();
  const recursionStack = new Set<KPIName>();

  function hasCycle(kpi: KPIName): boolean {
    if (recursionStack.has(kpi)) return true;
    if (visited.has(kpi)) return false;

    visited.add(kpi);
    recursionStack.add(kpi);

    const config = configs.get(kpi);
    if (config) {
      for (const dep of config.dependsOn) {
        if (hasCycle(dep)) return true;
      }
    }

    recursionStack.delete(kpi);
    return false;
  }

  for (const kpi of configs.keys()) {
    if (hasCycle(kpi)) {
      console.error(`Cycle detected involving KPI: ${kpi}`);
      return false;
    }
  }

  return true;
}
