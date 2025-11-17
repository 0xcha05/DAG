import { useState } from 'react';
import { KPIRebalancingEngine } from './engine/KPIEngine';
import { KPIGrid } from './components/KPIGrid';
import { DAGVisualization } from './components/DAGVisualization';
import { ConfigEditor } from './components/ConfigEditor';
import { LogsPanel } from './components/LogsPanel';
import { QueryDisplay } from './components/QueryDisplay';
import { kpiConfigs } from './data/kpiConfig';
import { generateInitialData, cloneProductData } from './data/initialData';
import type { ProductData, KPIName, KPIConfig, LogEntry } from './types';
import { TrendingUp, Network, Settings, RefreshCw, AlertCircle, FileText, Database } from 'lucide-react';
import { generateRebalancingQueries, type GeneratedQuery } from './services/clickhouse-query-service';

type TabType = 'grid' | 'dag' | 'config' | 'logs';
type ExecutionMode = 'in-memory' | 'clickhouse';

function App() {
  const [productData, setProductData] = useState<ProductData>(generateInitialData());
  const [configs, setConfigs] = useState<KPIConfig[]>(kpiConfigs);
  const [engine, setEngine] = useState<KPIRebalancingEngine>(
    new KPIRebalancingEngine(kpiConfigs)
  );
  const [activeTab, setActiveTab] = useState<TabType>('grid');
  const [highlightedChanges, setHighlightedChanges] = useState<Set<string>>(new Set());
  const [highlightedKPIs, setHighlightedKPIs] = useState<Set<KPIName>>(new Set());
  const [lockedKPIs, setLockedKPIs] = useState<Set<KPIName>>(new Set());
  const [lastEdit, setLastEdit] = useState<{
    week: number;
    kpi: KPIName;
    value: number;
  } | null>(null);
  const [changeLog, setChangeLog] = useState<string[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('in-memory');
  const [generatedQueries, setGeneratedQueries] = useState<GeneratedQuery[]>([]);
  const [showQueries, setShowQueries] = useState(false);

  const handleEditKPI = (week: number, kpi: KPIName, value: number) => {
    try {
      // Clone the current data
      const newProductData = cloneProductData(productData);

      // Run the rebalancing engine
      const result = engine.rebalance(newProductData, week, kpi, value);

      if (executionMode === 'clickhouse') {
        // Generate ClickHouse queries instead of executing
        const queries = generateRebalancingQueries(
          productData.productId,
          2024, // Year - could be made dynamic
          result,
          kpi,
          week,
          value
        );

        setGeneratedQueries(queries);
        setShowQueries(true);

        // Still update UI to show what would change
        setLastEdit({ week, kpi, value });

        const changes = new Set<string>();
        result.changes.forEach(change => {
          changes.add(`${change.week}-${change.kpi}`);
        });
        setHighlightedChanges(changes);
        setHighlightedKPIs(result.affectedKPIs);

        const config = engine.getConfig(kpi);
        const locked = new Set<KPIName>(config?.locksWhenEdited || []);
        locked.add(kpi);
        setLockedKPIs(locked);

        // Clear highlights after showing queries
        setTimeout(() => {
          setHighlightedChanges(new Set());
          setHighlightedKPIs(new Set());
          setLockedKPIs(new Set());
        }, 5000);
      } else {
        // In-memory execution (original behavior)
        // Apply the updates
        result.updatedWeeks.forEach((weekData, weekNum) => {
          newProductData.weeks.set(weekNum, weekData);
        });

        setProductData(newProductData);

        // Highlight the changes
        const changes = new Set<string>();
        result.changes.forEach(change => {
          changes.add(`${change.week}-${change.kpi}`);
        });
        setHighlightedChanges(changes);
        setHighlightedKPIs(result.affectedKPIs);

        // Get locked KPIs
        const config = engine.getConfig(kpi);
        const locked = new Set<KPIName>(config?.locksWhenEdited || []);
        locked.add(kpi);
        setLockedKPIs(locked);

        // Update last edit
        setLastEdit({ week, kpi, value });

        // Add to change log
        const logEntries = result.changes.map(
          change =>
            `W${change.week} ${change.kpi}: ${change.oldValue.toFixed(2)} → ${change.newValue.toFixed(2)}`
        );
        setChangeLog(prev => [...logEntries, ...prev].slice(0, 20)); // Keep last 20 changes

        // Add to logs
        setLogs(prev => [...result.logs, ...prev]); // Prepend new logs

        // Clear highlights after 3 seconds
        setTimeout(() => {
          setHighlightedChanges(new Set());
          setHighlightedKPIs(new Set());
          setLockedKPIs(new Set());
        }, 3000);
      }
    } catch (error) {
      console.error('Error rebalancing KPIs:', error);
      alert(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleUpdateConfig = (kpi: KPIName, updates: Partial<KPIConfig>) => {
    const newConfigs = configs.map(c => (c.name === kpi ? { ...c, ...updates } : c));
    setConfigs(newConfigs);

    // Recreate the engine with updated configs
    const newEngine = new KPIRebalancingEngine(newConfigs);
    setEngine(newEngine);

    alert(`Configuration updated for ${kpi}`);
  };

  const handleReset = () => {
    if (confirm('Reset all data to initial values?')) {
      setProductData(generateInitialData());
      setHighlightedChanges(new Set());
      setHighlightedKPIs(new Set());
      setLockedKPIs(new Set());
      setLastEdit(null);
      setChangeLog([]);
      setLogs([]);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <TrendingUp className="w-8 h-8 text-blue-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">KPI Rebalancing Engine</h1>
                <p className="text-sm text-gray-600">
                  DAG-based Merchandising Analytics POC
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Execution Mode Toggle */}
              <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg">
                <button
                  onClick={() => setExecutionMode('in-memory')}
                  className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    executionMode === 'in-memory'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <RefreshCw className="w-4 h-4" />
                  In-Memory
                </button>
                <button
                  onClick={() => setExecutionMode('clickhouse')}
                  className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    executionMode === 'clickhouse'
                      ? 'bg-white text-green-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Database className="w-4 h-4" />
                  ClickHouse
                </button>
              </div>
              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Reset Data
              </button>
            </div>
          </div>
          {/* Mode Description */}
          <div className="mt-3 text-xs text-gray-600">
            {executionMode === 'in-memory' ? (
              <span>✓ In-Memory Mode: Changes are applied immediately and data is updated in real-time</span>
            ) : (
              <span className="text-green-600">⚡ ClickHouse Mode: Generates SQL queries without executing (preview only)</span>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Product Info */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {productData.productName}
              </h2>
              <p className="text-sm text-gray-600">Product ID: {productData.productId}</p>
            </div>
            {lastEdit && (
              <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-lg">
                <AlertCircle className="w-4 h-4 text-blue-600" />
                <div className="text-sm">
                  <span className="font-medium text-blue-900">Last Edit:</span>
                  <span className="text-blue-700 ml-2">
                    Week {lastEdit.week} - {lastEdit.kpi} = {lastEdit.value.toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px">
              <button
                onClick={() => setActiveTab('grid')}
                className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'grid'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <TrendingUp className="w-4 h-4" />
                KPI Grid
              </button>
              <button
                onClick={() => setActiveTab('dag')}
                className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'dag'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Network className="w-4 h-4" />
                Dependency DAG
              </button>
              <button
                onClick={() => setActiveTab('config')}
                className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'config'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Settings className="w-4 h-4" />
                Configuration
              </button>
              <button
                onClick={() => setActiveTab('logs')}
                className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'logs'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <FileText className="w-4 h-4" />
                Logs
                {logs.length > 0 && (
                  <span className="bg-blue-100 text-blue-600 text-xs px-2 py-0.5 rounded-full">
                    {logs.filter(l => l.type === 'user-edit').length}
                  </span>
                )}
              </button>
            </nav>
          </div>

          <div className="p-4">
            {activeTab === 'grid' && (
              <div>
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Instructions:</h3>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Click on any editable cell (blue background) to modify values</li>
                    <li>• Hover over editable cells to preview cascading effects (darker to lighter orange)</li>
                    {executionMode === 'in-memory' ? (
                      <>
                        <li>• Watch dependent KPIs recalculate automatically</li>
                        <li>• Yellow highlights show changed values</li>
                      </>
                    ) : (
                      <>
                        <li className="text-green-600 font-medium">• ClickHouse mode: Edits will generate SQL queries instead of updating data</li>
                        <li className="text-green-600 font-medium">• Queries show INSERT (logs) and UPDATE (values) statements</li>
                      </>
                    )}
                    <li>• Locked KPIs (gray) maintain their values during edits</li>
                  </ul>
                </div>
                <KPIGrid
                  productData={productData}
                  configs={configs}
                  onEditKPI={handleEditKPI}
                  highlightedChanges={highlightedChanges}
                  lockedKPIs={lockedKPIs}
                />
              </div>
            )}

            {activeTab === 'dag' && (
              <div>
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">
                    Dependency Graph:
                  </h3>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Click any node to highlight dependencies (click again to deselect)</li>
                    <li>• Purple: Selected node | Blue: Parents | Orange: Children</li>
                    <li>• Blue nodes: Editable KPIs | Green nodes: Calculated KPIs</li>
                    <li>• Arrows show data flow direction</li>
                  </ul>
                </div>
                <DAGVisualization
                  configs={configs}
                  highlightedKPIs={highlightedKPIs}
                  lockedKPIs={lockedKPIs}
                />
              </div>
            )}

            {activeTab === 'config' && (
              <div>
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">
                    Configuration Editor:
                  </h3>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Select a KPI to view its configuration</li>
                    <li>• Edit formulas to change calculation logic</li>
                    <li>• View dependencies and lock strategies</li>
                  </ul>
                </div>
                <ConfigEditor configs={configs} onUpdateConfig={handleUpdateConfig} />
              </div>
            )}

            {activeTab === 'logs' && (
              <div className="flex flex-col h-full">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">
                    Edit History & Logs:
                  </h3>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Blue entries: User edits (manual changes)</li>
                    <li>• Green entries: System recalculations (cascading effects)</li>
                    <li>• Click to expand and view triggered recalculations</li>
                    <li>• Calculation levels show dependency order</li>
                  </ul>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden" style={{ height: '500px' }}>
                  <LogsPanel logs={logs} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Change Log - Only show on grid/dag/config tabs */}
        {activeTab !== 'logs' && changeLog.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Recent Changes</h3>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {changeLog.map((log, index) => (
                <div
                  key={index}
                  className="text-xs font-mono text-gray-600 bg-gray-50 px-3 py-1 rounded"
                >
                  {log}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <p className="text-xs text-gray-500 text-center">
            KPI Rebalancing Engine POC - Demonstrating DAG-based merchandising analytics
          </p>
        </div>
      </footer>

      {/* Query Display Modal */}
      {showQueries && (
        <QueryDisplay
          queries={generatedQueries}
          onClose={() => setShowQueries(false)}
        />
      )}
    </div>
  );
}

export default App;
