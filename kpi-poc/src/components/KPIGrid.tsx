import React, { useState } from 'react';
import { ProductData, KPIName, KPIConfig } from '../types';
import { formatKPIValue, parseKPIValue } from '../engine/formulas';
import { Edit2, Lock, Calculator } from 'lucide-react';

interface KPIGridProps {
  productData: ProductData;
  configs: KPIConfig[];
  onEditKPI: (week: number, kpi: KPIName, value: number) => void;
  highlightedChanges?: Set<string>; // Format: "week-kpi"
  lockedKPIs?: Set<KPIName>;
}

export const KPIGrid: React.FC<KPIGridProps> = ({
  productData,
  configs,
  onEditKPI,
  highlightedChanges = new Set(),
  lockedKPIs = new Set(),
}) => {
  const [editingCell, setEditingCell] = useState<{ week: number; kpi: KPIName } | null>(null);
  const [editValue, setEditValue] = useState('');

  const weeks = Array.from(productData.weeks.keys()).sort((a, b) => a - b);

  const handleCellClick = (week: number, kpi: KPIName, config: KPIConfig) => {
    if (!config.isEditable || lockedKPIs.has(kpi)) return;

    const weekData = productData.weeks.get(week);
    if (!weekData) return;

    setEditingCell({ week, kpi });
    setEditValue(formatKPIValue(weekData.values[kpi], kpi));
  };

  const handleCellBlur = () => {
    if (editingCell) {
      const value = parseKPIValue(editValue);
      if (!isNaN(value)) {
        onEditKPI(editingCell.week, editingCell.kpi, value);
      }
    }
    setEditingCell(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCellBlur();
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  };

  const getCellClassName = (week: number, kpi: KPIName, config: KPIConfig): string => {
    const changeKey = `${week}-${kpi}`;
    const isHighlighted = highlightedChanges.has(changeKey);
    const isLocked = lockedKPIs.has(kpi);
    const isEditable = config.isEditable && !isLocked;

    let classes = 'px-3 py-2 text-right font-mono text-sm border-r border-gray-200 ';

    if (isHighlighted) {
      classes += 'bg-yellow-100 animate-pulse ';
    } else if (isLocked) {
      classes += 'bg-gray-100 text-gray-500 ';
    } else if (isEditable) {
      classes += 'bg-white hover:bg-blue-50 cursor-pointer ';
    } else {
      classes += 'bg-gray-50 text-gray-700 ';
    }

    return classes;
  };

  const renderCellIcon = (config: KPIConfig, kpi: KPIName): JSX.Element | null => {
    if (lockedKPIs.has(kpi)) {
      return <Lock className="w-3 h-3 text-gray-400" />;
    }
    if (config.isEditable) {
      return <Edit2 className="w-3 h-3 text-blue-400" />;
    }
    if (config.formula) {
      return <Calculator className="w-3 h-3 text-green-400" />;
    }
    return null;
  };

  return (
    <div className="overflow-auto border border-gray-300 rounded-lg shadow-sm">
      <table className="min-w-full divide-y divide-gray-300">
        <thead className="bg-gray-100 sticky top-0">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-300 sticky left-0 bg-gray-100 z-10">
              KPI
            </th>
            {weeks.map(week => (
              <th
                key={week}
                className="px-3 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-300"
              >
                Week {week}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {configs.map(config => (
            <tr key={config.name} className="hover:bg-gray-50">
              <td className="px-4 py-2 text-sm font-medium text-gray-900 border-r border-gray-300 sticky left-0 bg-white z-10">
                <div className="flex items-center gap-2">
                  {renderCellIcon(config, config.name)}
                  <span>{config.displayName}</span>
                </div>
              </td>
              {weeks.map(week => {
                const weekData = productData.weeks.get(week);
                const value = weekData?.values[config.name] ?? 0;
                const isEditing =
                  editingCell?.week === week && editingCell?.kpi === config.name;

                return (
                  <td
                    key={`${week}-${config.name}`}
                    className={getCellClassName(week, config.name, config)}
                    onClick={() => handleCellClick(week, config.name, config)}
                  >
                    {isEditing ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={handleCellBlur}
                        onKeyDown={handleKeyDown}
                        className="w-full bg-transparent text-right outline-none"
                        autoFocus
                      />
                    ) : (
                      formatKPIValue(value, config.name)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
