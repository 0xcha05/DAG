import React, { useMemo, useState, useCallback, useEffect } from 'react';
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

  // Determine border and background colors based on highlight state
  let borderColor = 'border-gray-300';
  let bgColor = 'bg-gray-100';
  let opacity = 'opacity-100';

  if (data.hoverState === 'self') {
    // The hovered node itself - bright highlight
    borderColor = 'border-purple-500';
    bgColor = 'bg-purple-100';
  } else if (data.hoverState === 'parent') {
    // Nodes that this node depends on
    borderColor = 'border-blue-400';
    bgColor = 'bg-blue-50';
  } else if (data.hoverState === 'child') {
    // Nodes that depend on this node
    borderColor = 'border-orange-400';
    bgColor = 'bg-orange-50';
  } else if (data.hoverState === 'dimmed') {
    // Other nodes when something is hovered
    opacity = 'opacity-30';
    borderColor = data.isLocked ? 'border-gray-300' : data.isEditable ? 'border-blue-400' : 'border-green-400';
    bgColor = data.isLocked ? 'bg-gray-100' : data.isEditable ? 'bg-blue-50' : 'bg-green-50';
  } else if (data.isHighlighted) {
    // Changed KPIs
    borderColor = 'border-yellow-400';
    bgColor = 'bg-yellow-50';
  } else {
    // Default colors
    borderColor = data.isLocked ? 'border-gray-300' : data.isEditable ? 'border-blue-400' : 'border-green-400';
    bgColor = data.isLocked ? 'bg-gray-100' : data.isEditable ? 'bg-blue-50' : 'bg-green-50';
  }

  return (
    <>
      {/* Input handle (left side - receives connections) */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: '#6b7280', width: 8, height: 8 }}
      />

      <div
        className={`px-4 py-3 rounded-lg border-2 ${borderColor} ${bgColor} ${opacity} shadow-md min-w-[160px] cursor-pointer hover:shadow-lg transition-all duration-200`}
        onMouseEnter={() => data.onMouseEnter?.(data.kpi)}
        onMouseLeave={() => data.onMouseLeave?.()}
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
  const [hoveredNode, setHoveredNode] = useState<KPIName | null>(null);

  // Build dependency maps
  const { parentMap, childMap } = useMemo(() => {
    const parents = new Map<KPIName, Set<KPIName>>();
    const children = new Map<KPIName, Set<KPIName>>();

    configs.forEach(config => {
      if (!children.has(config.name)) children.set(config.name, new Set());

      config.dependsOn.forEach(dep => {
        if (!parents.has(config.name)) parents.set(config.name, new Set());
        parents.get(config.name)!.add(dep);

        if (!children.has(dep)) children.set(dep, new Set());
        children.get(dep)!.add(config.name);
      });
    });

    return { parentMap: parents, childMap: children };
  }, [configs]);

  const handleNodeMouseEnter = useCallback((kpi: KPIName) => {
    setHoveredNode(kpi);
  }, []);

  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNode(null);
  }, []);

  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    return buildDAGLayout(
      configs,
      highlightedKPIs,
      lockedKPIs,
      onNodeClick,
      handleNodeMouseEnter,
      handleNodeMouseLeave,
      hoveredNode,
      parentMap,
      childMap
    );
  }, [configs, highlightedKPIs, lockedKPIs, onNodeClick, handleNodeMouseEnter, handleNodeMouseLeave, hoveredNode, parentMap, childMap]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes and edges when hover state changes
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

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
            if (node.data.hoverState === 'self') return '#a855f7';
            if (node.data.hoverState === 'parent') return '#60a5fa';
            if (node.data.hoverState === 'child') return '#fb923c';
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
  onNodeClick: ((kpi: KPIName) => void) | undefined,
  onNodeMouseEnter: (kpi: KPIName) => void,
  onNodeMouseLeave: () => void,
  hoveredNode: KPIName | null,
  parentMap: Map<KPIName, Set<KPIName>>,
  childMap: Map<KPIName, Set<KPIName>>
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Calculate hover states for all nodes
  const getHoverState = (kpi: KPIName): 'self' | 'parent' | 'child' | 'dimmed' | null => {
    if (!hoveredNode) return null;
    if (kpi === hoveredNode) return 'self';
    if (parentMap.get(hoveredNode)?.has(kpi)) return 'parent';
    if (childMap.get(hoveredNode)?.has(kpi)) return 'child';
    return 'dimmed';
  };

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
        hoverState: getHoverState(config.name),
        onClick: onNodeClick,
        onMouseEnter: onNodeMouseEnter,
        onMouseLeave: onNodeMouseLeave,
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
          hoverState: getHoverState(config.name),
          onClick: onNodeClick,
          onMouseEnter: onNodeMouseEnter,
          onMouseLeave: onNodeMouseLeave,
        },
      });
    });
  });

  // Create edges based on dependencies
  configs.forEach(config => {
    config.dependsOn.forEach(dependency => {
      const isHighlighted = highlightedKPIs.has(config.name) || highlightedKPIs.has(dependency);

      // Check if edge should be highlighted due to hover
      let isHoverHighlighted = false;
      let hoverColor = '#9ca3af';
      if (hoveredNode) {
        // Highlight edges FROM the hovered node to its children
        if (dependency === hoveredNode && childMap.get(hoveredNode)?.has(config.name)) {
          isHoverHighlighted = true;
          hoverColor = '#fb923c'; // Orange for outgoing (to children)
        }
        // Highlight edges TO the hovered node from its parents
        else if (config.name === hoveredNode && parentMap.get(hoveredNode)?.has(dependency)) {
          isHoverHighlighted = true;
          hoverColor = '#60a5fa'; // Blue for incoming (from parents)
        }
      }

      const finalHighlight = isHighlighted || isHoverHighlighted;
      const strokeColor = isHoverHighlighted ? hoverColor : isHighlighted ? '#fbbf24' : '#9ca3af';
      const strokeWidth = finalHighlight ? 3 : 2;
      const opacity = hoveredNode && !isHoverHighlighted ? 0.2 : 1;

      edges.push({
        id: `${dependency}-${config.name}`,
        source: dependency,
        target: config.name,
        type: 'smoothstep',
        animated: finalHighlight,
        style: {
          stroke: strokeColor,
          strokeWidth: strokeWidth,
          opacity: opacity,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
          color: strokeColor,
        },
        label: finalHighlight ? '→' : undefined,
        labelStyle: {
          fill: strokeColor,
          fontWeight: 700,
          fontSize: 16,
        },
        labelBgStyle: {
          fill: isHoverHighlighted ? (hoverColor === '#fb923c' ? '#fff7ed' : '#eff6ff') : '#fffbeb',
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
