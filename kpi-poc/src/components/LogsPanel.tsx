import React, { useState } from 'react';
import type { LogEntry } from '../types';
import { User, Cpu, ChevronDown, ChevronRight } from 'lucide-react';

interface LogsPanelProps {
  logs: LogEntry[];
}

export const LogsPanel: React.FC<LogsPanelProps> = ({ logs }) => {
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

  const toggleExpand = (logId: string) => {
    const newExpanded = new Set(expandedLogs);
    if (newExpanded.has(logId)) {
      newExpanded.delete(logId);
    } else {
      newExpanded.add(logId);
    }
    setExpandedLogs(newExpanded);
  };

  // Group logs by user edits (each user edit with its triggered recalculations)
  const groupedLogs: { userEdit: LogEntry; systemRecalcs: LogEntry[] }[] = [];
  let currentGroup: { userEdit: LogEntry; systemRecalcs: LogEntry[] } | null = null;

  for (const log of logs) {
    if (log.type === 'user-edit') {
      if (currentGroup) {
        groupedLogs.push(currentGroup);
      }
      currentGroup = { userEdit: log, systemRecalcs: [] };
    } else if (currentGroup && log.type === 'system-recalc') {
      currentGroup.systemRecalcs.push(log);
    }
  }
  if (currentGroup) {
    groupedLogs.push(currentGroup);
  }

  const formatValue = (value: number) => {
    if (Number.isInteger(value)) return value.toString();
    return value.toFixed(2);
  };

  const formatTime = (timestamp: Date) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="w-full h-full overflow-y-auto bg-gray-50 p-4">
      <h2 className="text-lg font-bold mb-4 text-gray-800">Edit History</h2>

      {groupedLogs.length === 0 && (
        <div className="text-gray-500 text-center py-8">
          No edits yet. Edit a KPI value in the grid to see logs here.
        </div>
      )}

      <div className="space-y-3">
        {groupedLogs.map((group, index) => {
          const isExpanded = expandedLogs.has(group.userEdit.id);
          const ChevronIcon = isExpanded ? ChevronDown : ChevronRight;

          return (
            <div
              key={group.userEdit.id}
              className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden"
            >
              {/* User Edit Header */}
              <div
                className="p-3 bg-blue-50 border-b border-blue-100 cursor-pointer hover:bg-blue-100 transition-colors"
                onClick={() => toggleExpand(group.userEdit.id)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-2 flex-1">
                    <User className="w-4 h-4 text-blue-600 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-blue-900">
                          User Edit #{groupedLogs.length - index}
                        </span>
                        <span className="text-xs text-gray-500">
                          {formatTime(group.userEdit.timestamp)}
                        </span>
                      </div>
                      <div className="text-sm mt-1">
                        <span className="font-medium text-gray-700">
                          {group.userEdit.kpi}
                        </span>
                        <span className="text-gray-500 mx-2">:</span>
                        <span className="text-red-600">
                          {formatValue(group.userEdit.oldValue)}
                        </span>
                        <span className="text-gray-500 mx-1">→</span>
                        <span className="text-green-600 font-semibold">
                          {formatValue(group.userEdit.newValue)}
                        </span>
                        {group.systemRecalcs.length > 0 && (
                          <span className="ml-2 text-xs text-gray-600">
                            (triggered {group.systemRecalcs.length} recalculation{group.systemRecalcs.length > 1 ? 's' : ''})
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronIcon className="w-4 h-4 text-gray-400" />
                  </div>
                </div>
              </div>

              {/* System Recalculations (Expanded) */}
              {isExpanded && group.systemRecalcs.length > 0 && (
                <div className="p-3 bg-gray-50">
                  <div className="text-xs font-semibold text-gray-600 mb-2 uppercase">
                    Cascading Recalculations
                  </div>
                  <div className="space-y-2">
                    {group.systemRecalcs.map((recalc, idx) => (
                      <div
                        key={recalc.id}
                        className="bg-white p-2 rounded border border-gray-200"
                      >
                        <div className="flex items-start gap-2">
                          <Cpu className="w-3.5 h-3.5 text-green-600 mt-0.5" />
                          <div className="flex-1 text-sm">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono bg-green-100 text-green-800 px-1.5 py-0.5 rounded">
                                Level {recalc.calculationLevel}
                              </span>
                              <span className="font-medium text-gray-700">
                                {recalc.kpi}
                              </span>
                            </div>
                            <div className="mt-1 text-xs">
                              <span className="text-red-600">
                                {formatValue(recalc.oldValue)}
                              </span>
                              <span className="text-gray-500 mx-1">→</span>
                              <span className="text-green-600 font-semibold">
                                {formatValue(recalc.newValue)}
                              </span>
                            </div>
                            {recalc.formula && (
                              <div className="mt-1 text-xs font-mono bg-gray-100 text-gray-700 px-2 py-1 rounded">
                                {recalc.formula}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
