import { getTriggerService, TriggerService } from './TriggerService';
import { Trigger } from '../database/entities/Trigger';
import { createExecutionAgentRuntime } from '../agents';
import { ToolExecutionContext } from '../tools/Tool';
import { logInfo, logError, logDebug, logWarn } from '../utils/logger';

const DEFAULT_POLL_INTERVAL_MS = 30_000; // 30 seconds

/**
 * TriggerScheduler polls for due triggers and dispatches them to execution agents.
 */
export class TriggerScheduler {
  private triggerService: TriggerService;
  private pollIntervalMs: number;
  private pollTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isProcessing = false;

  constructor(pollIntervalMs = DEFAULT_POLL_INTERVAL_MS) {
    this.triggerService = getTriggerService();
    this.pollIntervalMs = pollIntervalMs;
  }

  /**
   * Start the scheduler polling loop.
   */
  start(): void {
    if (this.isRunning) {
      logWarn('TriggerScheduler already running');
      return;
    }

    this.isRunning = true;
    logInfo('TriggerScheduler started', { pollIntervalMs: this.pollIntervalMs });

    // Run immediately, then poll
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  /**
   * Stop the scheduler.
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    logInfo('TriggerScheduler stopped');
  }

  /**
   * Poll for due triggers and process them.
   */
  private async poll(): Promise<void> {
    if (this.isProcessing) {
      logDebug('TriggerScheduler skipping poll - already processing');
      return;
    }

    this.isProcessing = true;

    try {
      const result = await this.triggerService.getDueTriggers();

      if (!result.success || !result.data || result.data.length === 0) {
        return;
      }

      logInfo('TriggerScheduler processing due triggers', { count: result.data.length });

      // Process triggers sequentially to avoid overwhelming the system
      for (const trigger of result.data) {
        await this.processTrigger(trigger);
      }

    } catch (error) {
      logError('TriggerScheduler poll failed', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single trigger by dispatching to an execution agent.
   */
  private async processTrigger(trigger: Trigger): Promise<void> {
    logInfo('Dispatching trigger', {
      id: trigger.id,
      agentName: trigger.agentName,
      userId: trigger.userId
    });

    try {
      // Create execution context for the trigger
      const context: ToolExecutionContext = {
        userHandle: 'trigger-scheduler',
        userId: trigger.userId,
        conversationId: `trigger-${trigger.id}`,
        isAdmin: false
      };

      // Create and run execution agent
      const runtime = createExecutionAgentRuntime(trigger.agentName, context);
      const result = await runtime.execute(trigger.payload);

      logInfo('Trigger execution completed', {
        triggerId: trigger.id,
        agentName: trigger.agentName,
        success: result.success,
        toolsUsed: result.toolsUsed
      });

      // Mark trigger as executed (calculates next trigger time for recurring)
      await this.triggerService.markTriggerExecuted(
        trigger.id,
        result.success ? undefined : result.error
      );

      // If the execution produced a response, we might want to notify the user
      // This could be enhanced to send via iMessage
      if (result.success && result.response) {
        logDebug('Trigger produced response', {
          triggerId: trigger.id,
          responsePreview: result.response.substring(0, 100)
        });
        // TODO: Optionally send response to user via iMessage
      }

    } catch (error: any) {
      logError('Trigger execution failed', error, {
        triggerId: trigger.id,
        agentName: trigger.agentName
      });

      // Mark trigger with error
      await this.triggerService.markTriggerExecuted(trigger.id, error.message);
    }
  }

  /**
   * Manually trigger a specific trigger (for testing).
   */
  async triggerNow(triggerId: number): Promise<void> {
    const result = await this.triggerService.getTrigger(triggerId);
    if (result.success && result.data) {
      await this.processTrigger(result.data);
    }
  }
}

// Singleton instance
let schedulerInstance: TriggerScheduler | null = null;

export function getTriggerScheduler(): TriggerScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new TriggerScheduler();
  }
  return schedulerInstance;
}

export function startTriggerScheduler(): void {
  getTriggerScheduler().start();
}

export function stopTriggerScheduler(): void {
  if (schedulerInstance) {
    schedulerInstance.stop();
  }
}
