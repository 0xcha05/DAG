import React, { useState } from 'react';
import type { KPIConfig, KPIName } from '../types';
import { Settings, X, Edit, Check } from 'lucide-react';

interface ConfigEditorProps {
  configs: KPIConfig[];
  onUpdateConfig: (kpi: KPIName, updates: Partial<KPIConfig>) => void;
}

export const ConfigEditor: React.FC<ConfigEditorProps> = ({ configs, onUpdateConfig }) => {
  const [selectedKPI, setSelectedKPI] = useState<KPIName | null>(null);
  const [editingFormula, setEditingFormula] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);

  const selectedConfig = configs.find(c => c.name === selectedKPI);

  const handleSelectKPI = (kpi: KPIName) => {
    setSelectedKPI(kpi);
    const config = configs.find(c => c.name === kpi);
    setEditingFormula(config?.formula || '');
    setIsEditing(false);
  };

  const handleSaveFormula = () => {
    if (selectedKPI) {
      onUpdateConfig(selectedKPI, { formula: editingFormula });
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    if (selectedConfig) {
      setEditingFormula(selectedConfig.formula || '');
    }
    setIsEditing(false);
  };

  return (
    <div className="border border-gray-300 rounded-lg shadow-sm bg-white p-4">
      <div className="flex items-center gap-2 mb-4">
        <Settings className="w-5 h-5 text-gray-600" />
        <h3 className="text-lg font-semibold text-gray-800">KPI Configuration Editor</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* KPI List */}
        <div className="border border-gray-200 rounded-lg p-3 max-h-[500px] overflow-y-auto">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Select KPI</h4>
          <div className="space-y-1">
            {configs.map(config => (
              <button
                key={config.name}
                onClick={() => handleSelectKPI(config.name)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  selectedKPI === config.name
                    ? 'bg-blue-100 text-blue-900 font-medium'
                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>{config.displayName}</span>
                  {config.formula && <span className="text-xs text-gray-500">Formula</span>}
                </div>
                <div className="text-xs text-gray-500 mt-1">{config.name}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Config Details */}
        <div className="border border-gray-200 rounded-lg p-3">
          {selectedConfig ? (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-1">
                  {selectedConfig.displayName}
                </h4>
                <p className="text-xs text-gray-600">{selectedConfig.description}</p>
              </div>

              <div className="border-t border-gray-200 pt-3">
                <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                  <div>
                    <span className="text-gray-600">Type:</span>
                    <span className="ml-2 font-medium">
                      {selectedConfig.isEditable ? 'Editable' : 'Calculated'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">Dependencies:</span>
                    <span className="ml-2 font-medium">{selectedConfig.dependsOn.length}</span>
                  </div>
                </div>

                {selectedConfig.dependsOn.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs text-gray-600 mb-1">Depends On:</div>
                    <div className="flex flex-wrap gap-1">
                      {selectedConfig.dependsOn.map(dep => (
                        <span
                          key={dep}
                          className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded"
                        >
                          {dep}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {selectedConfig.locksWhenEdited.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs text-gray-600 mb-1">Locks When Edited:</div>
                    <div className="flex flex-wrap gap-1">
                      {selectedConfig.locksWhenEdited.map(lock => (
                        <span
                          key={lock}
                          className="px-2 py-1 bg-gray-100 text-gray-800 text-xs rounded"
                        >
                          {lock}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {selectedConfig.formula !== undefined && (
                <div className="border-t border-gray-200 pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-700">Formula</label>
                    {!isEditing ? (
                      <button
                        onClick={() => setIsEditing(true)}
                        className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                      >
                        <Edit className="w-3 h-3" />
                        Edit
                      </button>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveFormula}
                          className="text-sm text-green-600 hover:text-green-800 flex items-center gap-1"
                        >
                          <Check className="w-3 h-3" />
                          Save
                        </button>
                        <button
                          onClick={handleCancel}
                          className="text-sm text-gray-600 hover:text-gray-800 flex items-center gap-1"
                        >
                          <X className="w-3 h-3" />
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>

                  {isEditing ? (
                    <textarea
                      value={editingFormula}
                      onChange={e => setEditingFormula(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      rows={3}
                      placeholder="Enter formula (e.g., Sls $ / Sls U)"
                    />
                  ) : (
                    <div className="px-3 py-2 bg-gray-50 rounded-md font-mono text-sm text-gray-800 border border-gray-200">
                      {selectedConfig.formula || 'No formula defined'}
                    </div>
                  )}

                  <div className="mt-2 text-xs text-gray-500">
                    Use KPI names directly in formulas. Example: "Sls $ / Sls U"
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500 text-sm">
              Select a KPI to view and edit its configuration
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
