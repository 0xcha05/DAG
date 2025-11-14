import { evaluate } from 'mathjs';
import { KPIName, KPIValue } from '../types';

/**
 * Safely evaluates a formula string with given KPI values.
 * Formulas use KPI names directly (e.g., "Sls $ / Sls U")
 *
 * @param formula - The formula string to evaluate
 * @param values - Current KPI values
 * @returns The calculated result
 */
export function evaluateFormula(formula: string, values: KPIValue): number {
  try {
    // Create a scope with all KPI values
    // Replace KPI names with their values
    let processedFormula = formula;

    // Replace each KPI name with its value
    Object.keys(values).forEach(kpi => {
      // Escape special regex characters and handle spaces
      const escapedKPI = kpi.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedKPI, 'g');
      processedFormula = processedFormula.replace(regex, String(values[kpi]));
    });

    // Evaluate using mathjs
    const result = evaluate(processedFormula);

    // Handle division by zero and other edge cases
    if (!isFinite(result)) return 0;
    if (isNaN(result)) return 0;

    return result;
  } catch (error) {
    console.error(`Error evaluating formula "${formula}":`, error);
    return 0;
  }
}

/**
 * Validates that a formula string is syntactically correct
 */
export function validateFormula(formula: string, availableKPIs: string[]): boolean {
  try {
    // Create a test scope with dummy values
    const testValues: KPIValue = {};
    availableKPIs.forEach(kpi => {
      testValues[kpi] = 1; // Use 1 to avoid division by zero
    });

    evaluateFormula(formula, testValues);
    return true;
  } catch (error) {
    console.error(`Formula validation failed for "${formula}":`, error);
    return false;
  }
}

/**
 * Extracts KPI names referenced in a formula
 */
export function extractKPIsFromFormula(formula: string, availableKPIs: KPIName[]): KPIName[] {
  const referencedKPIs: KPIName[] = [];

  availableKPIs.forEach(kpi => {
    if (formula.includes(kpi)) {
      referencedKPIs.push(kpi);
    }
  });

  return referencedKPIs;
}

/**
 * Formats a number for display in the UI
 */
export function formatKPIValue(value: number, kpiName: KPIName): string {
  // Percentages
  if (kpiName.includes('%')) {
    return (value * 100).toFixed(2) + '%';
  }

  // Dollar values
  if (kpiName.includes('$')) {
    return '$' + value.toFixed(2);
  }

  // Units (whole numbers)
  if (kpiName.includes('U')) {
    return Math.round(value).toString();
  }

  // Default to 2 decimal places
  return value.toFixed(2);
}

/**
 * Parses a formatted string back to a number
 */
export function parseKPIValue(formatted: string): number {
  // Remove $, %, commas, and other formatting
  const cleaned = formatted.replace(/[$,%]/g, '').trim();
  const value = parseFloat(cleaned);

  // If it was a percentage, divide by 100
  if (formatted.includes('%')) {
    return value / 100;
  }

  return isNaN(value) ? 0 : value;
}
