export interface RelOpNode {
  id: string;
  name: string;
  physicalOp: string;
  logicalOp: string;
  estimateRows: number;
  actualRows?: number;
  actualRowsRead?: number;
  actualCPUms?: number;
  actualElapsedms?: number;
  actualLogicalReads?: number;
  estimateIO: number;
  estimateCPU: number;
  avgRowSize: number;
  totalCost: number;
  children: RelOpNode[];
  properties: Record<string, any>;
  // Diagnostics
  warnings: string[];
  actualExecutions?: number;
  estimatedRowsRead?: number;
}

export interface QueryPlanMetrics {
  totalElapsedTimeMs: number;
  totalCpuTimeMs: number;
  dop: number;
  totalLogicalReads: number;
  grantedMemoryKb: number;
  usedMemoryKb: number;
  hasSpills: boolean;
  hasHighCxPacket: boolean;
}

export interface QueryPlanData {
  statementText: string;
  statementId: number;
  statementType: string;
  subTreeCost: number;
  root: RelOpNode | null;
  missingIndexes?: any[];
  metrics?: QueryPlanMetrics;
}
