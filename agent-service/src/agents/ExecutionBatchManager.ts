import { EventEmitter } from 'events';
import { ExecutionAgentRuntime, ExecutionResult } from './ExecutionAgentRuntime';
import { ToolExecutionContext } from '../tools/Tool';
import { logInfo, logError, logDebug, logWarn } from '../utils/logger';

/**
 * Pending execution tracking.
 */
interface PendingExecution {
  requestId: string;
  agentName: string;
  instructions: string;
  batchId: string;
  createdAt: Date;
}

/**
 * Batch state for coordinating multiple executions.
 */
interface BatchState {
  batchId: string;
  createdAt: Date;
  pending: number;
  results: ExecutionResult[];
}

/**
 * ExecutionBatchManager coordinates multiple execution agents and batches results.
 * When all executions in a batch complete, it dispatches results to the interaction agent.
 */
export class ExecutionBatchManager extends EventEmitter {
  private timeoutSeconds = 90;
  private pending: Map<string, PendingExecution> = new Map();
  private batchState: BatchState | null = null;
  private context: ToolExecutionContext;
  private onBatchComplete?: (payload: string) => Promise<void>;

  constructor(context: ToolExecutionContext) {
    super();
    this.context = context;
  }

  /**
   * Set callback for when a batch completes.
   */
  setOnBatchComplete(callback: (payload: string) => Promise<void>): void {
    this.onBatchComplete = callback;
  }

  /**
   * Execute an agent with the given instructions.
   * Returns the execution result.
   */
  async executeAgent(
    agentName: string,
    instructions: string,
    requestId?: string
  ): Promise<ExecutionResult> {
    const id = requestId || crypto.randomUUID();
    const batchId = this.registerPendingExecution(agentName, instructions, id);

    logInfo('ExecutionBatchManager starting agent execution', {
      agentName,
      requestId: id,
      batchId
    });

    try {
      const runtime = new ExecutionAgentRuntime(agentName, this.context);
      
      // Execute with timeout
      const result = await Promise.race([
        runtime.execute(instructions),
        this.createTimeout(this.timeoutSeconds)
      ]);

      await this.completeExecution(batchId, result, agentName);
      return result;

    } catch (error: any) {
      const timeoutResult: ExecutionResult = {
        agentName,
        success: false,
        response: `Execution timed out after ${this.timeoutSeconds} seconds`,
        toolsUsed: [],
        iterationCount: 0,
        error: error.message || 'Timeout'
      };

      await this.completeExecution(batchId, timeoutResult, agentName);
      return timeoutResult;

    } finally {
      this.pending.delete(id);
    }
  }

  /**
   * Register a pending execution and return the batch ID.
   */
  private registerPendingExecution(
    agentName: string,
    instructions: string,
    requestId: string
  ): string {
    // Create new batch if none exists
    if (!this.batchState) {
      this.batchState = {
        batchId: crypto.randomUUID(),
        createdAt: new Date(),
        pending: 0,
        results: []
      };
      logDebug('ExecutionBatchManager created new batch', { 
        batchId: this.batchState.batchId 
      });
    }

    const batchId = this.batchState.batchId;
    this.batchState.pending++;

    this.pending.set(requestId, {
      requestId,
      agentName,
      instructions,
      batchId,
      createdAt: new Date()
    });

    return batchId;
  }

  /**
   * Complete an execution and check if batch is done.
   */
  private async completeExecution(
    batchId: string,
    result: ExecutionResult,
    agentName: string
  ): Promise<void> {
    if (!this.batchState || this.batchState.batchId !== batchId) {
      logWarn('ExecutionBatchManager received result for unknown batch', {
        batchId,
        agentName
      });
      return;
    }

    this.batchState.results.push(result);
    this.batchState.pending--;

    logDebug('ExecutionBatchManager execution completed', {
      batchId,
      agentName,
      success: result.success,
      remaining: this.batchState.pending
    });

    // When all executions complete, dispatch to interaction agent
    if (this.batchState.pending === 0) {
      const payload = this.formatBatchPayload(this.batchState.results);
      const completedBatch = this.batchState;
      this.batchState = null;

      logInfo('ExecutionBatchManager batch completed', {
        batchId: completedBatch.batchId,
        resultCount: completedBatch.results.length
      });

      await this.dispatchToInteractionAgent(payload);
    }
  }

  /**
   * Format batch results into a payload string.
   */
  private formatBatchPayload(results: ExecutionResult[]): string {
    return results.map(r => {
      const status = r.success ? 'SUCCESS' : 'FAILED';
      const toolInfo = r.toolsUsed.length > 0 
        ? ` (tools: ${r.toolsUsed.join(', ')})` 
        : '';
      return `[${status}] ${r.agentName}${toolInfo}: ${r.response}`;
    }).join('\n\n');
  }

  /**
   * Dispatch batch results to the interaction agent.
   */
  private async dispatchToInteractionAgent(payload: string): Promise<void> {
    logDebug('ExecutionBatchManager dispatching to interaction agent', {
      payloadLength: payload.length
    });

    if (this.onBatchComplete) {
      try {
        await this.onBatchComplete(payload);
      } catch (error) {
        logError('ExecutionBatchManager dispatch callback failed', error);
      }
    } else {
      // Emit event as fallback
      this.emit('batchComplete', payload);
    }
  }

  /**
   * Create a timeout promise.
   */
  private createTimeout(seconds: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Timeout after ${seconds} seconds`));
      }, seconds * 1000);
    });
  }

  /**
   * Get current batch state (for debugging).
   */
  getBatchState(): BatchState | null {
    return this.batchState;
  }

  /**
   * Get pending execution count.
   */
  getPendingCount(): number {
    return this.pending.size;
  }
}

// Factory function
export function createExecutionBatchManager(context: ToolExecutionContext): ExecutionBatchManager {
  return new ExecutionBatchManager(context);
}
