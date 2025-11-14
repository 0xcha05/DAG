import type { KPIConfig, KPIName, WeekData, RebalancingResult, ProductData } from '../types';
import { topologicalSort } from './topologicalSort';
import { evaluateFormula } from './formulas';

export class KPIRebalancingEngine {
  private configs: Map<KPIName, KPIConfig>;
  private damageRate = 0.1; // 10% damage rate for returns

  constructor(configs: KPIConfig[]) {
    this.configs = new Map(configs.map(c => [c.name, c]));
  }

  /**
   * Main rebalancing method: handles both linear calculations and multi-week effects
   */
  rebalance(
    productData: ProductData,
    weekNumber: number,
    editedKPI: KPIName,
    newValue: number
  ): RebalancingResult {
    const changes: RebalancingResult['changes'] = [];
    const affectedKPIs = new Set<KPIName>();
    const updatedWeeks = new Map<number, WeekData>();

    // Get the current week's data
    const currentWeek = productData.weeks.get(weekNumber);
    if (!currentWeek) {
      throw new Error(`Week ${weekNumber} not found`);
    }

    // Clone current values
    const currentValues = { ...currentWeek.values };
    const oldValue = currentValues[editedKPI];

    // Special handling: When editing Sls U, recalculate Sls $ to maintain AUR
    if (editedKPI === 'Sls U') {
      const existingAUR = currentValues['AUR'];
      const newSlsDollars = newValue * existingAUR;
      const oldSlsDollars = currentValues['Sls $'];

      currentValues['Sls $'] = newSlsDollars;
      changes.push({
        week: weekNumber,
        kpi: 'Sls $',
        oldValue: oldSlsDollars,
        newValue: newSlsDollars,
      });
      affectedKPIs.add('Sls $');
    }

    // Apply the edit
    currentValues[editedKPI] = newValue;
    changes.push({
      week: weekNumber,
      kpi: editedKPI,
      oldValue,
      newValue,
    });
    affectedKPIs.add(editedKPI);

    // Get lock strategy
    const editConfig = this.configs.get(editedKPI);
    const lockedKPIs = new Set<KPIName>(editConfig?.locksWhenEdited || []);
    lockedKPIs.add(editedKPI); // The edited KPI itself is locked

    // Phase 1: Linear calculations in the current week
    const calculationOrder = topologicalSort(this.configs, editedKPI, lockedKPIs);

    console.log('[KPIEngine] ========== REBALANCE START ==========');
    console.log('[KPIEngine] Edited:', editedKPI, '=', newValue);
    console.log('[KPIEngine] Locked KPIs:', Array.from(lockedKPIs));
    console.log('[KPIEngine] Calculation order:', calculationOrder);
    console.log('[KPIEngine] Current values:', currentValues);

    for (const level of calculationOrder) {
      console.log(`\n[KPIEngine] === Level with ${level.length} KPIs ===`);
      for (const kpi of level) {
        const config = this.configs.get(kpi);
        if (!config || !config.formula) {
          console.log(`  [SKIP] ${kpi} - no formula`);
          continue;
        }

        const oldKPIValue = currentValues[kpi];
        console.log(`  [CALC] ${kpi}: "${config.formula}"`);
        const newKPIValue = evaluateFormula(config.formula, currentValues);
        console.log(`    ${oldKPIValue} → ${newKPIValue}`);

        currentValues[kpi] = newKPIValue;
        affectedKPIs.add(kpi);

        if (Math.abs(oldKPIValue - newKPIValue) > 0.001) {
          changes.push({
            week: weekNumber,
            kpi,
            oldValue: oldKPIValue,
            newValue: newKPIValue,
          });
        }
      }
    }
    console.log('[KPIEngine] ========== REBALANCE END ==========\n');

    // Update current week
    updatedWeeks.set(weekNumber, {
      ...currentWeek,
      values: currentValues as Record<KPIName, number>,
      lastEdited: {
        kpi: editedKPI,
        timestamp: new Date(),
      },
    });

    // Phase 2: Handle multi-week effects
    this.handleMultiWeekEffects(
      productData,
      weekNumber,
      currentValues,
      affectedKPIs,
      updatedWeeks,
      changes
    );

    return {
      updatedWeeks,
      affectedKPIs,
      calculationOrder,
      changes,
    };
  }

  /**
   * Handles complex multi-week dependencies
   */
  private handleMultiWeekEffects(
    productData: ProductData,
    weekNumber: number,
    currentValues: Record<string, number>,
    affectedKPIs: Set<KPIName>,
    updatedWeeks: Map<number, WeekData>,
    changes: RebalancingResult['changes']
  ) {
    // Handle Return Inventory (4 weeks later)
    if (affectedKPIs.has('Return U')) {
      this.handleReturnInventory(
        productData,
        weekNumber,
        currentValues,
        updatedWeeks,
        changes
      );
    }

    // Handle EOP/BOP transition (next week)
    if (affectedKPIs.has('EOP U') || affectedKPIs.has('EOP $')) {
      this.handleEOPBOPTransition(
        productData,
        weekNumber,
        currentValues,
        updatedWeeks,
        changes
      );
    }
  }

  /**
   * Return Units from current week become Return Inventory 4 weeks later
   */
  private handleReturnInventory(
    productData: ProductData,
    weekNumber: number,
    currentValues: Record<string, number>,
    updatedWeeks: Map<number, WeekData>,
    changes: RebalancingResult['changes']
  ) {
    const returnUnits = currentValues['Return U'] || 0;
    const futureWeek = weekNumber + 4;
    const futureInventory = returnUnits * (1 - this.damageRate);

    const futureWeekData = productData.weeks.get(futureWeek);
    if (futureWeekData) {
      const oldValue = futureWeekData.values['Return Inv'] || 0;

      // Update future week's return inventory
      const updatedFutureWeek = updatedWeeks.get(futureWeek) || { ...futureWeekData };
      updatedFutureWeek.values['Return Inv'] = futureInventory;

      updatedWeeks.set(futureWeek, updatedFutureWeek);

      changes.push({
        week: futureWeek,
        kpi: 'Return Inv',
        oldValue,
        newValue: futureInventory,
      });

      // Recalculate EOP for that future week since Return Inv changed
      this.recalculateEOP(futureWeek, updatedFutureWeek.values, changes);
    }
  }

  /**
   * EOP from current week becomes BOP of next week
   */
  private handleEOPBOPTransition(
    productData: ProductData,
    weekNumber: number,
    currentValues: Record<string, number>,
    updatedWeeks: Map<number, WeekData>,
    changes: RebalancingResult['changes']
  ) {
    const eopUnits = currentValues['EOP U'] || 0;
    const eopDollars = currentValues['EOP $'] || 0;
    const nextWeek = weekNumber + 1;

    const nextWeekData = productData.weeks.get(nextWeek);
    if (nextWeekData) {
      const updatedNextWeek = updatedWeeks.get(nextWeek) || { ...nextWeekData };

      const oldBOPU = updatedNextWeek.values['BOP U'];
      const oldBOP$ = updatedNextWeek.values['BOP $'];

      updatedNextWeek.values['BOP U'] = eopUnits;
      updatedNextWeek.values['BOP $'] = eopDollars;

      updatedWeeks.set(nextWeek, updatedNextWeek);

      changes.push({
        week: nextWeek,
        kpi: 'BOP U',
        oldValue: oldBOPU,
        newValue: eopUnits,
      });

      changes.push({
        week: nextWeek,
        kpi: 'BOP $',
        oldValue: oldBOP$,
        newValue: eopDollars,
      });

      // Recalculate next week's EOP since BOP changed
      this.recalculateEOP(nextWeek, updatedNextWeek.values, changes);
    }
  }

  /**
   * Recalculates EOP based on the formula: EOP = BOP - Sls + Receipts + Return Inv
   */
  private recalculateEOP(
    weekNumber: number,
    values: Record<string, number>,
    changes: RebalancingResult['changes']
  ) {
    // EOP U = BOP U - Sls U + Total Rcpt U + Return Inv
    const oldEOPU = values['EOP U'];
    const newEOPU =
      (values['BOP U'] || 0) -
      (values['Sls U'] || 0) +
      (values['Total Rcpt U'] || 0) +
      (values['Return Inv'] || 0);

    values['EOP U'] = newEOPU;

    if (Math.abs(oldEOPU - newEOPU) > 0.001) {
      changes.push({
        week: weekNumber,
        kpi: 'EOP U',
        oldValue: oldEOPU,
        newValue: newEOPU,
      });
    }

    // EOP $ = BOP $ - COGS + Total Rcpt $ + Return Inv * AUC
    const oldEOP$ = values['EOP $'];
    const newEOP$ =
      (values['BOP $'] || 0) -
      (values['COGS'] || 0) +
      (values['Total Rcpt $'] || 0) +
      (values['Return Inv'] || 0) * (values['AUC'] || 0);

    values['EOP $'] = newEOP$;

    if (Math.abs(oldEOP$ - newEOP$) > 0.001) {
      changes.push({
        week: weekNumber,
        kpi: 'EOP $',
        oldValue: oldEOP$,
        newValue: newEOP$,
      });
    }
  }

  /**
   * Gets the configuration for a KPI
   */
  getConfig(kpi: KPIName): KPIConfig | undefined {
    return this.configs.get(kpi);
  }

  /**
   * Gets all configurations
   */
  getAllConfigs(): KPIConfig[] {
    return Array.from(this.configs.values());
  }

  /**
   * Updates a KPI configuration (for the config editor)
   */
  updateConfig(kpi: KPIName, updates: Partial<KPIConfig>) {
    const existing = this.configs.get(kpi);
    if (existing) {
      this.configs.set(kpi, { ...existing, ...updates });
    }
  }
}
