import { XMLParser } from 'fast-xml-parser';
import { RelOpNode, QueryPlanData, QueryPlanMetrics } from './types';

export function parseQueryPlan(xml: string): QueryPlanData[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: true,
  });

  const jsonObj = parser.parse(xml);
  const plans: QueryPlanData[] = [];

  // Recursive function to find all statements
  function findStatements(obj: any) {
    if (!obj || typeof obj !== 'object') return;

    // Check if this object is a statement (StmtSimple, StmtCond, etc.)
    if (obj.StatementText) {
      const queryPlan = obj.QueryPlan;
      const rootRelOp = queryPlan?.RelOp;
      
      // Extract Global Metrics
      let metrics: QueryPlanMetrics | undefined;
      if (queryPlan) {
        const memoryGrant = queryPlan.MemoryGrantInfo;
        const runtimeInfo = queryPlan.RunTimeInformation;
        
        metrics = {
          totalElapsedTimeMs: 0,
          totalCpuTimeMs: 0,
          dop: parseInt(queryPlan.DegreeOfParallelism) || 1,
          totalLogicalReads: 0,
          grantedMemoryKb: parseInt(memoryGrant?.GrantedMemory) || 0,
          usedMemoryKb: parseInt(memoryGrant?.MaxUsedMemory) || 0,
          hasSpills: false,
          hasHighCxPacket: false
        };

        // Check for CXPACKET waits
        if (queryPlan.WaitStats?.Wait) {
          const waits = Array.isArray(queryPlan.WaitStats.Wait) ? queryPlan.WaitStats.Wait : [queryPlan.WaitStats.Wait];
          const cxPacket = waits.find((w: any) => w.WaitType === 'CXPACKET');
          if (cxPacket && parseInt(cxPacket.WaitTimeMs) > 100) {
            metrics.hasHighCxPacket = true;
          }
        }
      }

      // Extract Missing Indexes
      let missingIndexes = [];
      if (queryPlan?.MissingIndexes) {
        const groups = queryPlan.MissingIndexes.MissingIndexGroup;
        missingIndexes = Array.isArray(groups) ? groups : [groups];
      }

      const root = rootRelOp ? parseRelOp(rootRelOp, null) : null;

      // Post-process to calculate global metrics from the tree
      if (metrics && root) {
        let treeHasLogicalReads = false;
        const traverse = (node: RelOpNode) => {
          metrics!.totalElapsedTimeMs = Math.max(metrics!.totalElapsedTimeMs, node.actualElapsedms || 0);
          metrics!.totalCpuTimeMs += node.actualCPUms || 0;
          
          if (node.actualLogicalReads !== undefined) {
            metrics!.totalLogicalReads += node.actualLogicalReads;
            treeHasLogicalReads = true;
          }

          if (node.warnings.includes('MEMORY SPILL')) metrics!.hasSpills = true;
          node.children.forEach(traverse);
        };
        traverse(root);

        // Fallback to actualRowsRead if no ActualLogicalReads were found (older SQL versions)
        if (!treeHasLogicalReads) {
          const fallbackTraverse = (node: RelOpNode) => {
            metrics!.totalLogicalReads += node.actualRowsRead || 0;
            node.children.forEach(fallbackTraverse);
          };
          fallbackTraverse(root);
        }
      }

      plans.push({
        statementText: obj.StatementText,
        statementId: parseInt(obj.StatementId) || 0,
        statementType: obj.StatementType || 'UNKNOWN',
        subTreeCost: obj.StatementSubTreeCost || 0,
        root,
        missingIndexes: missingIndexes.length > 0 ? missingIndexes : undefined,
        metrics
      });
    }

    // Recurse into all keys
    for (const key in obj) {
      const value = obj[key];
      if (Array.isArray(value)) {
        value.forEach(item => findStatements(item));
      } else if (typeof value === 'object') {
        findStatements(value);
      }
    }
  }

  findStatements(jsonObj);

  // Sort by StatementId numerically
  return plans.sort((a, b) => a.statementId - b.statementId);
}

function parseRelOp(relOp: any, parent: RelOpNode | null): RelOpNode {
  // Aggregate Runtime Information
  let actualRows = 0;
  let actualRowsRead = 0;
  let actualCPUms = 0;
  let actualElapsedms = 0;
  let actualExecutions = 0;
  let actualLogicalReads = 0;
  let hasLogicalReadsAttr = false;
  let hasRuntime = false;

  if (relOp.RunTimeInformation?.RunTimeCountersPerThread) {
    hasRuntime = true;
    const counters = Array.isArray(relOp.RunTimeInformation.RunTimeCountersPerThread)
      ? relOp.RunTimeInformation.RunTimeCountersPerThread
      : [relOp.RunTimeInformation.RunTimeCountersPerThread];
    
    counters.forEach((c: any) => {
      actualRows += parseInt(c.ActualRows) || 0;
      actualRowsRead += parseInt(c.ActualRowsRead) || 0;
      actualCPUms += parseInt(c.ActualCPUms) || 0;
      actualElapsedms += parseInt(c.ActualElapsedms) || 0;
      actualExecutions += parseInt(c.ActualExecutions) || 1;
      if (c.ActualLogicalReads !== undefined) {
        actualLogicalReads += parseInt(c.ActualLogicalReads) || 0;
        hasLogicalReadsAttr = true;
      }
    });
  }

  const warnings: string[] = [];
  
  // Row Goal Detection
  const hasRowGoal = relOp.EstimateRowsWithoutRowGoal !== undefined || relOp.PhysicalOp === 'Top';
  if (hasRowGoal) {
    warnings.push('ROW GOAL OPTIMIZATION ACTIVE');
  }

  // Memory Spill Detection
  if (relOp.Warnings?.SpillToTempdb) {
    warnings.push('MEMORY SPILL');
  }

  // Large Scan Detection
  if (actualRowsRead > 1000000 && (relOp.PhysicalOp?.includes('Scan') || relOp.PhysicalOp?.includes('Seek'))) {
    // Check if there's a predicate
    const hasPredicate = !!(relOp.IndexScan?.Predicate || relOp.TableScan?.Predicate);
    if (hasPredicate) {
      warnings.push('LARGE SCAN (potential missing index)');
    }
  }

  // Parallelism Analysis
  const isParallelism = ['Repartition Streams', 'Gather Streams', 'Distribute Streams'].includes(relOp.PhysicalOp);
  if (isParallelism) {
    if (relOp.PhysicalOp === 'Repartition Streams') {
      warnings.push('DATA REDISTRIBUTION (expensive)');
    }
    // High CXPACKET wait time is hard to detect from XML alone without WaitStats, 
    // but we can flag potential skew if threads have very different row counts.
    // For now, we'll stick to the requested labels.
  }

  const node: RelOpNode = {
    id: `node-${Math.random().toString(36).substr(2, 9)}`,
    name: relOp.PhysicalOp || 'Unknown',
    physicalOp: relOp.PhysicalOp || '',
    logicalOp: relOp.LogicalOp || '',
    estimateRows: relOp.EstimateRows || 0,
    actualRows: hasRuntime ? actualRows : undefined,
    actualRowsRead: hasRuntime ? actualRowsRead : undefined,
    actualCPUms: hasRuntime ? actualCPUms : undefined,
    actualElapsedms: hasRuntime ? actualElapsedms : undefined,
    actualExecutions: hasRuntime ? actualExecutions : undefined,
    actualLogicalReads: hasLogicalReadsAttr ? actualLogicalReads : undefined,
    estimateIO: relOp.EstimateIO || 0,
    estimateCPU: relOp.EstimateCPU || 0,
    avgRowSize: relOp.AvgRowSize || 0,
    totalCost: relOp.EstimatedTotalSubtreeCost || 0,
    children: [],
    properties: relOp,
    warnings,
    estimatedRowsRead: relOp.IndexScan?.EstimateRowsRead || relOp.TableScan?.EstimateRowsRead
  };

  // Find all children RelOps
  for (const key in relOp) {
    const value = relOp[key];
    if (value && typeof value === 'object') {
      if (value.RelOp) {
        const childrenRaw = value.RelOp;
        const childrenList = Array.isArray(childrenRaw) ? childrenRaw : [childrenRaw];
        node.children.push(...childrenList.map((c: any) => parseRelOp(c, node)));
      }
    }
  }

  // Nested Loops Amplification Detection (Post-children parse for inner operator check)
  if (node.physicalOp === 'Nested Loops') {
    // Usually the second child is the inner one
    const innerChild = node.children[1];
    if (innerChild && innerChild.actualExecutions && innerChild.actualExecutions > 10) {
      node.warnings.push('NESTED LOOPS MULTI-EXECUTION (potential amplification)');
    }
  }

  // Early Terminating Scan Detection
  if (node.physicalOp?.includes('Scan') && parent?.physicalOp === 'Top') {
    if (node.actualRowsRead !== undefined && node.estimateRows > 0) {
      if (node.actualRowsRead < node.estimateRows * 0.1) {
        node.warnings.push('EARLY TERMINATION (efficient scan)');
      }
    }
  }

  return node;
}
