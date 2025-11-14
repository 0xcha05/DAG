import React, { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  Handle,
  Position,
} from '@xyflow/react';
import type { Node, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { KPIConfig, KPIName } from '../types';
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
    <>
      {/* Input handle (left side - receives connections) */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: '#6b7280', width: 8, height: 8 }}
      />

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

      {/* Output handle (right side - sends connections) */}
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: '#6b7280', width: 8, height: 8 }}
      />
    </>
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

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div className="w-full h-[700px] border border-gray-300 rounded-lg shadow-sm bg-gray-50">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{
          padding: 0.2,
          minZoom: 0.5,
          maxZoom: 1.2,
        }}
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: false,
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          color="#9ca3af"
          gap={16}
          size={1}
        />
        <Controls
          showZoom={true}
          showFitView={true}
          showInteractive={true}
        />
        <MiniMap
          nodeStrokeWidth={3}
          nodeColor={(node) => {
            if (node.data.isHighlighted) return '#fef08a';
            if (node.data.isLocked) return '#e5e7eb';
            if (node.data.isEditable) return '#dbeafe';
            return '#d1fae5';
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
          position="bottom-right"
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
  const editableKPIs = configs.filter(c => c.isEditable).sort((a, b) => a.name.localeCompare(b.name));

  // Layout parameters - increased spacing to prevent overlap
  const horizontalSpacing = 350;
  const verticalSpacing = 180;

  // Position editable KPIs on the left - vertically centered
  const editableStartY = (editableKPIs.length > 0) ? -(editableKPIs.length - 1) * verticalSpacing / 2 : 0;
  editableKPIs.forEach((config, index) => {
    nodes.push({
      id: config.name,
      type: 'custom',
      position: { x: 0, y: editableStartY + index * verticalSpacing },
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
    // Sort within level for consistency
    const sortedLevel = [...level].sort((a, b) => {
      // Sort by number of dependencies (simpler ones first)
      const aDeps = a.dependsOn.length;
      const bDeps = b.dependsOn.length;
      if (aDeps !== bDeps) return aDeps - bDeps;
      return a.name.localeCompare(b.name);
    });

    // Center this level vertically
    const levelStartY = (sortedLevel.length > 0) ? -(sortedLevel.length - 1) * verticalSpacing / 2 : 0;

    sortedLevel.forEach((config, indexInLevel) => {
      nodes.push({
        id: config.name,
        type: 'custom',
        position: {
          x: (levelIndex + 1.5) * horizontalSpacing,
          y: levelStartY + indexInLevel * verticalSpacing,
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
      const isHighlighted = highlightedKPIs.has(config.name) || highlightedKPIs.has(dependency);

      edges.push({
        id: `${dependency}-${config.name}`,
        source: dependency,
        target: config.name,
        type: 'smoothstep',
        animated: isHighlighted,
        style: {
          stroke: isHighlighted ? '#fbbf24' : '#9ca3af',
          strokeWidth: isHighlighted ? 3 : 2,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
          color: isHighlighted ? '#fbbf24' : '#9ca3af',
        },
        label: isHighlighted ? '→' : undefined,
        labelStyle: {
          fill: '#fbbf24',
          fontWeight: 700,
          fontSize: 16,
        },
        labelBgStyle: {
          fill: '#fffbeb',
          fillOpacity: 0.7
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
