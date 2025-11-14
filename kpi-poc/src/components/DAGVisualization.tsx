import React, { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { KPIConfig, KPIName } from '../types';
import { Edit2, Calculator, Lock } from 'lucide-react';

interface DAGVisualizationProps {
  configs: KPIConfig[];
  highlightedKPIs?: Set<KPIName>;
  lockedKPIs?: Set<KPIName>;
  onNodeClick?: (kpi: KPIName) => void;
}

const CustomNode = ({ data }: any) => {
  const Icon = data.isEditable ? Edit2 : data.isLocked ? Lock : Calculator;
  const borderColor = data.isHighlighted
    ? 'border-yellow-400'
    : data.isLocked
    ? 'border-gray-300'
    : data.isEditable
    ? 'border-blue-400'
    : 'border-green-400';
  const bgColor = data.isHighlighted
    ? 'bg-yellow-50'
    : data.isLocked
    ? 'bg-gray-100'
    : data.isEditable
    ? 'bg-blue-50'
    : 'bg-green-50';

  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 ${borderColor} ${bgColor} shadow-md min-w-[160px] cursor-pointer hover:shadow-lg transition-shadow`}
      onClick={() => data.onClick?.(data.kpi)}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4" />
        <span className="font-semibold text-sm">{data.label}</span>
      </div>
      <div className="text-xs text-gray-600">{data.kpi}</div>
      {data.formula && (
        <div className="text-xs text-gray-500 mt-1 font-mono bg-white px-2 py-1 rounded">
          {data.formula}
        </div>
      )}
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

export const DAGVisualization: React.FC<DAGVisualizationProps> = ({
  configs,
  highlightedKPIs = new Set(),
  lockedKPIs = new Set(),
  onNodeClick,
}) => {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    return buildDAGLayout(configs, highlightedKPIs, lockedKPIs, onNodeClick);
  }, [configs, highlightedKPIs, lockedKPIs, onNodeClick]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div className="w-full h-[600px] border border-gray-300 rounded-lg shadow-sm bg-gray-50">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.5}
        maxZoom={1.5}
      >
        <Background />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            if (node.data.isHighlighted) return '#fef08a';
            if (node.data.isLocked) return '#e5e7eb';
            if (node.data.isEditable) return '#dbeafe';
            return '#d1fae5';
          }}
        />
      </ReactFlow>
    </div>
  );
};

/**
 * Builds the DAG layout with nodes and edges
 */
function buildDAGLayout(
  configs: KPIConfig[],
  highlightedKPIs: Set<KPIName>,
  lockedKPIs: Set<KPIName>,
  onNodeClick?: (kpi: KPIName) => void
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Group KPIs by category
  const editableKPIs = configs.filter(c => c.isEditable);
  const calculatedKPIs = configs.filter(c => !c.isEditable && c.formula);
  const inventoryKPIs = configs.filter(c =>
    ['BOP U', 'BOP $', 'EOP U', 'EOP $', 'Return Inv', 'Total Rcpt U', 'Total Rcpt $'].includes(
      c.name
    )
  );

  // Layout parameters
  const nodeWidth = 180;
  const nodeHeight = 100;
  const horizontalSpacing = 250;
  const verticalSpacing = 150;

  // Position editable KPIs on the left
  editableKPIs.forEach((config, index) => {
    nodes.push({
      id: config.name,
      type: 'custom',
      position: { x: 0, y: index * verticalSpacing },
      data: {
        kpi: config.name,
        label: config.displayName,
        formula: config.formula,
        isEditable: true,
        isLocked: lockedKPIs.has(config.name),
        isHighlighted: highlightedKPIs.has(config.name),
        onClick: onNodeClick,
      },
    });
  });

  // Position calculated KPIs based on dependency levels
  const levels = groupByDependencyLevel(configs);

  levels.forEach((level, levelIndex) => {
    level.forEach((config, indexInLevel) => {
      nodes.push({
        id: config.name,
        type: 'custom',
        position: {
          x: (levelIndex + 2) * horizontalSpacing,
          y: indexInLevel * verticalSpacing,
        },
        data: {
          kpi: config.name,
          label: config.displayName,
          formula: config.formula,
          isEditable: false,
          isLocked: lockedKPIs.has(config.name),
          isHighlighted: highlightedKPIs.has(config.name),
          onClick: onNodeClick,
        },
      });
    });
  });

  // Create edges based on dependencies
  configs.forEach(config => {
    config.dependsOn.forEach(dependency => {
      edges.push({
        id: `${dependency}-${config.name}`,
        source: dependency,
        target: config.name,
        type: 'smoothstep',
        animated: highlightedKPIs.has(config.name),
        style: {
          stroke: highlightedKPIs.has(config.name) ? '#fbbf24' : '#9ca3af',
          strokeWidth: highlightedKPIs.has(config.name) ? 3 : 2,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: highlightedKPIs.has(config.name) ? '#fbbf24' : '#9ca3af',
        },
      });
    });
  });

  return { nodes, edges };
}

/**
 * Groups KPIs into levels based on dependencies
 */
function groupByDependencyLevel(configs: KPIConfig[]): KPIConfig[][] {
  const levels: KPIConfig[][] = [];
  const processed = new Set<KPIName>();
  const configMap = new Map(configs.map(c => [c.name, c]));

  const getLevel = (config: KPIConfig): number => {
    if (!config.formula || config.dependsOn.length === 0) return 0;

    const depLevels = config.dependsOn
      .map(dep => {
        const depConfig = configMap.get(dep);
        return depConfig ? getLevel(depConfig) : 0;
      });

    return Math.max(...depLevels) + 1;
  };

  configs.forEach(config => {
    if (!config.isEditable && config.formula) {
      const level = getLevel(config);
      if (!levels[level]) levels[level] = [];
      levels[level].push(config);
    }
  });

  return levels.filter(level => level.length > 0);
}
