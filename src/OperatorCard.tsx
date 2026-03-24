import React, { useState, useEffect } from 'react';
import { RelOpNode } from './types';
import { ChevronRight, ChevronDown, Activity, Database, Cpu, HardDrive, List, Box } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface OperatorCardProps {
  node: RelOpNode;
  depth: number;
  forceExpand?: boolean;
  forceShowDetails?: boolean;
  metricMode: 'act' | 'est' | 'both';
}

const PropertyItem: React.FC<{ label: string; value: any }> = ({ label, value }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const isObject = typeof value === 'object' && value !== null;
  const jsonString = isObject ? JSON.stringify(value, null, 2) : String(value);
  const lineCount = jsonString.split('\n').length;
  const isLong = lineCount > 3 || jsonString.length > 100;

  if (!isObject && !isLong) {
    return (
      <div className="flex items-center justify-between text-[10px] font-mono border-b border-zinc-800/30 py-1">
        <span className="text-zinc-500">{label}</span>
        <span className="text-zinc-300 break-all text-right ml-4">{String(value)}</span>
      </div>
    );
  }

  return (
    <div className="space-y-1 py-1 border-b border-zinc-800/30">
      <button 
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between text-[10px] font-mono group"
      >
        <span className="text-zinc-500 flex items-center gap-1 group-hover:text-zinc-300 transition-colors">
          {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          {label}
          {isObject && Array.isArray(value) && (
            <span className="text-[8px] bg-zinc-800 px-1 rounded ml-1 text-zinc-600">
              {value.length} items
            </span>
          )}
        </span>
        {!isExpanded && (
          <span className="text-zinc-600 text-[9px] truncate ml-4 max-w-[200px]">
            {isObject ? '{...}' : jsonString.substring(0, 30) + '...'}
          </span>
        )}
      </button>
      
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <pre className="text-[9px] font-mono bg-black/40 p-2 rounded border border-zinc-800/50 text-zinc-400 overflow-x-auto scrollbar-thin whitespace-pre-wrap break-all mt-1">
              {jsonString}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const OperatorCard: React.FC<OperatorCardProps> = ({ node, depth, forceExpand, forceShowDetails, metricMode }) => {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const [showDetails, setShowDetails] = useState(false);

  // Sync with global controls
  useEffect(() => {
    if (forceExpand !== undefined) setIsExpanded(forceExpand);
  }, [forceExpand]);

  useEffect(() => {
    if (forceShowDetails !== undefined) setShowDetails(forceShowDetails);
  }, [forceShowDetails]);

  const costPercentage = (node.totalCost * 100).toFixed(2);
  const isHighCost = node.totalCost > 0.1;

  // Calculate skew/discrepancy
  const hasActual = node.actualRows !== undefined;
  const rowRatio = hasActual ? (node.estimateRows > 0 ? node.actualRows! / node.estimateRows : node.actualRows!) : 1;
  
  let ratioColor = 'text-zinc-300';
  let ratioWarning = false;
  let ratioCritical = false;

  if (hasActual) {
    if (rowRatio < 0.01 || rowRatio > 100) {
      ratioColor = 'text-red-500 font-bold';
      ratioCritical = true;
    } else if (rowRatio < 0.1 || rowRatio > 10) {
      ratioColor = 'text-amber-500 font-bold';
      ratioWarning = true;
    }
  }

  const isParallelism = ['Repartition Streams', 'Gather Streams', 'Distribute Streams'].includes(node.physicalOp);

  // Metric display logic
  const renderMetric = (est: number | string, act: number | string | undefined, label: string) => {
    if (metricMode === 'both') {
      return `${typeof est === 'number' ? est.toLocaleString() : est} / ${act !== undefined ? (typeof act === 'number' ? act.toLocaleString() : act) : '-'}`;
    }
    if (metricMode === 'act') {
      return act !== undefined ? (typeof act === 'number' ? act.toLocaleString() : act) : (typeof est === 'number' ? est.toLocaleString() : est);
    }
    return typeof est === 'number' ? est.toLocaleString() : est;
  };

  return (
    <div className="flex flex-col">
      <div 
        className={`flex items-start gap-3 p-3 rounded-lg border transition-all mb-2 ${isHighCost ? 'bg-red-500/5 border-red-500/20' : 'bg-zinc-900/50 border-zinc-800'} ${isParallelism ? 'border-blue-500/40 bg-blue-500/5 shadow-[0_0_15px_rgba(59,130,246,0.1)]' : ''} hover:border-zinc-600 group relative overflow-hidden`}
        style={{ marginLeft: `${depth * 24}px` }}
      >
        {(ratioCritical || ratioWarning) && (
          <div className={`absolute top-0 left-0 w-1 h-full ${ratioCritical ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]' : 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]'}`} title="High discrepancy between Actual and Estimate" />
        )}

        <button 
          onClick={() => setIsExpanded(!isExpanded)}
          className={`mt-1 p-0.5 rounded hover:bg-zinc-800 transition-colors ${node.children.length === 0 ? 'invisible' : ''}`}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-bold uppercase tracking-tight ${isHighCost ? 'text-red-400' : isParallelism ? 'text-blue-300' : 'text-blue-400'}`}>
                  {node.physicalOp}
                </span>
                <span className="text-[9px] text-zinc-600 font-mono">({node.logicalOp})</span>
              </div>
              
              {/* Diagnostic Labels */}
              <div className="flex flex-wrap gap-1 mt-1">
                {node.warnings.map((w, i) => (
                  <span key={i} className="px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded-[4px] text-[8px] font-bold uppercase tracking-wider border border-red-500/20">
                    {w}
                  </span>
                ))}
                {ratioCritical && (
                  <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded-[4px] text-[8px] font-bold uppercase tracking-wider border border-red-500/20">
                    CARDINALITY ESTIMATION ISSUE
                  </span>
                )}
                {node.actualExecutions && node.actualExecutions > 1 && (
                  <span className="px-1.5 py-0.5 bg-zinc-800 text-zinc-400 rounded-[4px] text-[8px] font-mono uppercase">
                    Executions: {node.actualExecutions}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 text-[10px] font-mono text-zinc-500">
                <Activity size={10} /> {costPercentage}%
              </div>
              <button 
                onClick={() => setShowDetails(!showDetails)}
                className="text-[9px] font-mono uppercase tracking-widest text-zinc-500 hover:text-white transition-colors border border-zinc-800 px-2 py-0.5 rounded bg-zinc-950"
              >
                {showDetails ? 'Hide Props' : 'View Props'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="flex flex-col">
              <div className="text-[8px] text-zinc-600 uppercase font-mono flex items-center gap-1 mb-0.5">
                <List size={10} /> Rows ({metricMode.toUpperCase()})
              </div>
              <div className={`text-[10px] font-mono ${ratioColor}`}>
                {renderMetric(node.estimateRows, node.actualRows, 'Rows')}
                {hasActual && (
                  <span className="text-[8px] ml-1 opacity-60">
                    (x{rowRatio < 1 ? rowRatio.toFixed(3) : rowRatio.toFixed(1)})
                  </span>
                )}
              </div>
            </div>

            {node.actualRowsRead !== undefined && (metricMode === 'act' || metricMode === 'both') && (
              <div className="flex flex-col">
                <div className="text-[8px] text-zinc-600 uppercase font-mono flex items-center gap-1 mb-0.5">
                  <Database size={10} /> Rows Read
                </div>
                <div className="text-[10px] font-mono text-zinc-300">
                  {node.actualRowsRead.toLocaleString()}
                  {node.estimatedRowsRead !== undefined && (
                    <span className="text-[8px] ml-1 opacity-50">
                      / {node.estimatedRowsRead.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            )}
            <StatItem 
              icon={<Cpu size={10} />} 
              label={`CPU (${metricMode.toUpperCase()})`} 
              value={renderMetric(node.estimateCPU.toFixed(4), node.actualCPUms !== undefined ? node.actualCPUms + 'ms' : undefined, 'CPU')} 
            />
            {hasActual && (metricMode === 'act' || metricMode === 'both') && (
              <StatItem 
                icon={<Activity size={10} />} 
                label="Elapsed" 
                value={`${node.actualElapsedms}ms`} 
              />
            )}
            <StatItem icon={<HardDrive size={10} />} label="IO Cost" value={node.estimateIO.toFixed(4)} />
            <StatItem icon={<Box size={10} />} label="Row Size" value={`${node.avgRowSize}B`} />
          </div>

          <AnimatePresence>
            {showDetails && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-4 pt-4 border-t border-zinc-800/50 grid grid-cols-1 gap-1">
                  {Object.entries(node.properties).map(([key, value]) => {
                    if (['PhysicalOp', 'LogicalOp', 'EstimateRows', 'EstimateIO', 'EstimateCPU', 'AvgRowSize', 'EstimatedTotalSubtreeCost', 'children', 'id'].includes(key)) return null;
                    return <PropertyItem key={key} label={key} value={value} />;
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {isExpanded && node.children.map((child, i) => (
        <OperatorCard 
          key={child.id} 
          node={child} 
          depth={depth + 1} 
          forceExpand={forceExpand}
          forceShowDetails={forceShowDetails}
          metricMode={metricMode}
        />
      ))}
    </div>
  );
};

function StatItem({ icon, label, value, highlight }: { icon: React.ReactNode, label: string, value: string, highlight?: boolean }) {
  return (
    <div className="flex flex-col">
      <div className="text-[8px] text-zinc-600 uppercase font-mono flex items-center gap-1 mb-0.5">
        {icon} {label}
      </div>
      <div className={`text-[10px] font-mono ${highlight ? 'text-orange-400 font-bold' : 'text-zinc-300'}`}>
        {value}
      </div>
    </div>
  );
}

export default OperatorCard;
