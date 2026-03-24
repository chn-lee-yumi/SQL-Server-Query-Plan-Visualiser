/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { parseQueryPlan } from './parser';
import { RelOpNode, QueryPlanData, QueryPlanMetrics } from './types';
import OperatorCard from './OperatorCard';
import { Database, Terminal, Layers, Code2, ChevronDown, ChevronUp, AlertTriangle, Zap, Cpu, Clock, MousePointer2, MemoryStick, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Helper to decode XML entities and clean up SQL text
function formatSql(text: string) {
  if (!text) return '';
  return text
    .replace(/&#x[dD];/gi, '\r')
    .replace(/&#x[aA];/gi, '\n')
    .replace(/\r\n/g, '\n')
    .trim();
}

function GlobalSummary({ metrics }: { metrics?: QueryPlanMetrics }) {
  if (!metrics) return null;

  const warnings = [];
  if (metrics.totalElapsedTimeMs > metrics.totalCpuTimeMs * 1.5) {
    warnings.push("WAITING / IO / PARALLELISM ISSUE (Elapsed >> CPU)");
  }
  if (metrics.dop > 1) {
    warnings.push(`PARALLEL PLAN (DOP: ${metrics.dop})`);
  }
  if (metrics.grantedMemoryKb > metrics.usedMemoryKb * 2 && metrics.grantedMemoryKb > 1024) {
    warnings.push("OVER-GRANTED MEMORY");
  }
  if (metrics.hasSpills) {
    warnings.push("MEMORY SPILL DETECTED");
  }
  if (metrics.hasHighCxPacket) {
    warnings.push("PARALLELISM SKEW / SYNCHRONIZATION COST (High CXPACKET)");
  }

  return (
    <div className="mb-6 space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <MetricCard 
          icon={<Clock size={14} />} 
          label="Elapsed Time" 
          value={`${metrics.totalElapsedTimeMs}ms`} 
          subValue="Total Wall Clock"
        />
        <MetricCard 
          icon={<Cpu size={14} />} 
          label="CPU Time" 
          value={`${metrics.totalCpuTimeMs}ms`} 
          subValue="Aggregate All Cores"
        />
        <MetricCard 
          icon={<MousePointer2 size={14} />} 
          label="DOP" 
          value={metrics.dop.toString()} 
          subValue="Degree of Parallelism"
          highlight={metrics.dop > 1}
        />
        <MetricCard 
          icon={<Database size={14} />} 
          label="Logical Reads" 
          value={metrics.totalLogicalReads.toLocaleString()} 
          subValue="Total Pages Read"
        />
        <MetricCard 
          icon={<MemoryStick size={14} />} 
          label="Memory Grant" 
          value={`${(metrics.grantedMemoryKb / 1024).toFixed(1)}MB`} 
          subValue={`Used: ${(metrics.usedMemoryKb / 1024).toFixed(1)}MB`}
          highlight={metrics.grantedMemoryKb > metrics.usedMemoryKb * 2}
        />
      </div>

      {warnings.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-[10px] font-bold uppercase tracking-wider animate-pulse">
              <AlertCircle size={12} /> {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricCard({ icon, label, value, subValue, highlight }: { icon: React.ReactNode, label: string, value: string, subValue: string, highlight?: boolean }) {
  return (
    <div className={`p-4 rounded-xl border ${highlight ? 'bg-blue-500/5 border-blue-500/30' : 'bg-zinc-900/30 border-zinc-800/50'} flex flex-col gap-1`}>
      <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest flex items-center gap-1.5">
        {icon} {label}
      </div>
      <div className={`text-lg font-bold tracking-tight ${highlight ? 'text-blue-400' : 'text-white'}`}>{value}</div>
      <div className="text-[9px] font-mono text-zinc-600">{subValue}</div>
    </div>
  );
}

function MissingIndexAlert({ groups }: { groups: any[] }) {
  return (
    <div className="space-y-3 mb-4">
      {groups.map((group, idx) => {
        const index = group.MissingIndex;
        const impact = group.Impact;
        
        // Extract columns
        const getCols = (usage: string) => {
          const colGroup = Array.isArray(index.ColumnGroup) 
            ? index.ColumnGroup.find((cg: any) => cg.Usage === usage)
            : (index.ColumnGroup?.Usage === usage ? index.ColumnGroup : null);
          
          if (!colGroup?.Column) return [];
          return Array.isArray(colGroup.Column) ? colGroup.Column : [colGroup.Column];
        };

        const eqCols = getCols('EQUALITY').map((c: any) => c.Name);
        const ineqCols = getCols('INEQUALITY').map((c: any) => c.Name);
        const incCols = getCols('INCLUDE').map((c: any) => c.Name);

        return (
          <div key={idx} className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
            <div className="flex items-center gap-2 text-amber-400 text-[11px] font-bold uppercase tracking-wider mb-3">
              <AlertTriangle size={14} /> Missing Index Recommendation (Impact: {impact}%)
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
              <div className="space-y-2">
                <div className="text-[10px] text-zinc-500 uppercase font-mono">Target Table</div>
                <div className="text-xs font-mono text-zinc-200">{index.Database}.{index.Schema}.{index.Table}</div>
              </div>
              <div className="space-y-2">
                <div className="text-[10px] text-zinc-500 uppercase font-mono">Suggested Columns</div>
                <div className="flex flex-wrap gap-1">
                  {eqCols.map(c => <span key={c} className="px-1.5 py-0.5 bg-amber-500/20 text-amber-200 rounded text-[9px] font-mono border border-amber-500/20">{c} (EQ)</span>)}
                  {ineqCols.map(c => <span key={c} className="px-1.5 py-0.5 bg-orange-500/20 text-orange-200 rounded text-[9px] font-mono border border-orange-500/20">{c} (INEQ)</span>)}
                  {incCols.map(c => <span key={c} className="px-1.5 py-0.5 bg-zinc-800 text-zinc-400 rounded text-[9px] font-mono border border-zinc-700">{c} (INC)</span>)}
                </div>
              </div>
            </div>

            <div className="bg-black/40 p-3 rounded-lg border border-zinc-800/50">
               <div className="text-[9px] text-zinc-600 uppercase font-mono mb-2 flex items-center gap-1">
                 <Zap size={10} /> Create Script Preview
               </div>
               <code className="text-[10px] font-mono text-zinc-400 leading-relaxed break-all">
                 CREATE INDEX [IX_Suggested] ON {index.Table} ({[...eqCols, ...ineqCols].join(', ')}) 
                 {incCols.length > 0 ? ` INCLUDE (${incCols.join(', ')})` : ''}
               </code>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const [xmlInput, setXmlInput] = useState('');
  const [plans, setPlans] = useState<QueryPlanData[]>([]);
  const [selectedPlanIndex, setSelectedPlanIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'input' | 'visual'>('input');
  const [showFullSql, setShowFullSql] = useState(true);
  const [globalExpandAll, setGlobalExpandAll] = useState(true);
  const [globalShowAllDetails, setGlobalShowAllDetails] = useState(false);
  const [metricMode, setMetricMode] = useState<'act' | 'est' | 'both'>('act');

  const handleParse = () => {
    try {
      const parsedPlans = parseQueryPlan(xmlInput);
      if (parsedPlans.length > 0) {
        setPlans(parsedPlans);
        setSelectedPlanIndex(0);
        setViewMode('visual');
        // Default to expanded nodes but collapsed props on new parse
        setGlobalExpandAll(true);
        setGlobalShowAllDetails(false);
        setMetricMode('act');
      } else {
        alert('No valid query plans found in XML.');
      }
    } catch (e) {
      console.error(e);
      alert('Error parsing XML. Please check the format.');
    }
  };

  const activePlan = plans[selectedPlanIndex];

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-300 font-sans selection:bg-blue-500/30">
      {/* Header */}
      <header className="h-14 border-b border-zinc-800/50 flex items-center px-6 justify-between bg-zinc-900/30 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/20">
            <Database size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight uppercase">Query Plan Visualizer</h1>
            <p className="text-[9px] text-zinc-500 font-mono uppercase tracking-[0.2em]">Data-First Execution Analysis</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => setViewMode('input')}
            className={`px-3 py-1.5 rounded text-[11px] font-bold uppercase tracking-wider transition-all ${viewMode === 'input' ? 'bg-white text-black' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            XML Input
          </button>
          <button 
            onClick={() => setViewMode('visual')}
            disabled={plans.length === 0}
            className={`px-3 py-1.5 rounded text-[11px] font-bold uppercase tracking-wider transition-all ${viewMode === 'visual' ? 'bg-white text-black' : 'text-zinc-500 hover:text-zinc-300 disabled:opacity-20'}`}
          >
            Plan Explorer
          </button>
        </div>
      </header>

      <main className="p-6 h-[calc(100vh-3.5rem)] overflow-hidden">
        <AnimatePresence mode="wait">
          {viewMode === 'input' ? (
            <motion.div 
              key="input"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="h-full flex flex-col gap-4"
            >
              <div className="flex-1 relative group bg-zinc-900/20 rounded-xl border border-zinc-800/50 overflow-hidden">
                <div className="absolute top-4 left-4 flex items-center gap-2 text-[10px] font-mono text-zinc-600 uppercase z-10 pointer-events-none">
                  <Terminal size={12} /> Source XML
                </div>
                <textarea
                  value={xmlInput}
                  onChange={(e) => setXmlInput(e.target.value)}
                  className="w-full h-full bg-transparent p-10 font-mono text-xs focus:outline-none transition-colors resize-none scrollbar-thin"
                  placeholder="Paste ShowPlan XML here..."
                />
              </div>
              <div className="flex justify-end">
                <button 
                  onClick={handleParse}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-10 py-4 rounded-full text-xs font-bold uppercase tracking-widest transition-all shadow-2xl shadow-blue-600/20 active:scale-95"
                >
                  Analyze Plan
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="visual"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full grid grid-cols-12 gap-6"
            >
              {/* Sidebar: Statement Selector - Full Height */}
              <div className="col-span-3 flex flex-col h-full bg-zinc-900/30 border border-zinc-800/50 rounded-xl overflow-hidden">
                <div className="p-4 border-b border-zinc-800/50 bg-zinc-900/20">
                  <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest flex items-center justify-between">
                    <span>Statements ({plans.length})</span>
                    <Layers size={12} />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 scrollbar-thin">
                  {plans.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedPlanIndex(i)}
                      className={`text-left p-3 rounded-lg border text-[10px] transition-all ${selectedPlanIndex === i ? 'bg-white text-black border-white' : 'bg-zinc-800/30 border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono opacity-50">ID: {p.statementId}</span>
                        <span className={`px-1.5 py-0.5 rounded-[4px] text-[8px] font-bold uppercase ${p.root ? 'bg-blue-500/20 text-blue-400' : 'bg-zinc-700/30 text-zinc-600'}`}>
                          {p.root ? 'Plan' : 'Logic'}
                        </span>
                      </div>
                      <div className="line-clamp-2 font-mono leading-relaxed">{formatSql(p.statementText)}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Main Explorer View */}
              <div className="col-span-9 h-full flex flex-col gap-4 overflow-hidden">
                {/* SQL Statement Header */}
                <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-xl overflow-hidden flex flex-col">
                  <button 
                    onClick={() => setShowFullSql(!showFullSql)}
                    className="flex items-center justify-between px-4 py-2 bg-zinc-800/30 hover:bg-zinc-800/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
                      <Code2 size={12} /> Statement {activePlan?.statementId} ({activePlan?.statementType})
                    </div>
                    {showFullSql ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  
                  <AnimatePresence initial={false}>
                    {showFullSql && (
                      <motion.div 
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="p-4 bg-zinc-950/50">
                          <pre className="text-[11px] font-mono text-blue-400/90 leading-relaxed whitespace-pre-wrap break-all max-h-[80px] overflow-y-auto scrollbar-thin">
                            {formatSql(activePlan?.statementText)}
                          </pre>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Global Controls */}
                <div className="flex items-center gap-4 px-1">
                  <button 
                    onClick={() => setGlobalExpandAll(!globalExpandAll)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded border text-[10px] font-bold uppercase tracking-wider transition-all ${globalExpandAll ? 'bg-blue-600 border-blue-500 text-white' : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}
                  >
                    {globalExpandAll ? 'Collapse All Nodes' : 'Expand All Nodes'}
                  </button>
                  <button 
                    onClick={() => setGlobalShowAllDetails(!globalShowAllDetails)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded border text-[10px] font-bold uppercase tracking-wider transition-all ${globalShowAllDetails ? 'bg-orange-600 border-orange-500 text-white' : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}
                  >
                    {globalShowAllDetails ? 'Hide All Props' : 'Show All Props'}
                  </button>

                  <div className="h-4 w-px bg-zinc-800 mx-1" />

                  <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
                    {(['est', 'act', 'both'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setMetricMode(mode)}
                        className={`px-3 py-1 rounded text-[9px] font-bold uppercase tracking-tighter transition-all ${
                          metricMode === mode 
                            ? 'bg-zinc-700 text-white shadow-sm' 
                            : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>

                  <div className="flex-1" />
                  <div className="text-[9px] font-mono text-zinc-600 uppercase">
                    Tip: Use Ctrl+F to search after expanding
                  </div>
                </div>

                {/* Operator List or Empty State */}
                <div className="flex-1 overflow-y-auto pr-4 scrollbar-thin pb-10">
                  <GlobalSummary metrics={activePlan?.metrics} />
                  
                  {activePlan?.missingIndexes && (
                    <MissingIndexAlert groups={activePlan.missingIndexes} />
                  )}
                  
                  {activePlan?.root ? (
                    <OperatorCard 
                      node={activePlan.root} 
                      depth={0} 
                      forceExpand={globalExpandAll}
                      forceShowDetails={globalShowAllDetails}
                      metricMode={metricMode}
                    />
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center p-12 bg-zinc-900/10 border border-dashed border-zinc-800/50 rounded-xl">
                      <Terminal size={32} className="text-zinc-800 mb-4" />
                      <h3 className="text-sm font-bold text-zinc-500 mb-1">No Execution Plan</h3>
                      <p className="text-[11px] text-zinc-600 font-mono max-w-xs leading-relaxed">
                        This statement ({activePlan?.statementType}) is a control flow or simple operation that does not generate a graphical execution plan.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
