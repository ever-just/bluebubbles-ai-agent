import { EventEmitter } from 'events';
import { config } from '../config';
import { logDebug, logWarn, logInfo, logError } from '../utils/logger';
import { RateLimiter, ManagedPermit } from './RateLimiter';
import { getNotificationService } from './NotificationService';

interface RequestOptions {
  priority?: number;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  description?: string;
  tags?: string[];
  retryOn429?: boolean;
  chatGuid?: string; // For typing indicator events
}

interface QueueItem<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  enqueuedAt: number;
  priority: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  description?: string;
  tags?: string[];
  retryCount: number;
  retryOn429: boolean;
  chatGuid?: string;
}

const DEFAULT_MAX_RETRIES = 4;
const BASE_RETRY_DELAY_MS = 1000;

export class AnthropicRequestManager extends EventEmitter {
  private readonly rateLimiter: RateLimiter;
  private readonly maxConcurrentRequests: number;
  private readonly inFlight = new Set<Promise<void>>();
  private readonly notifier = getNotificationService();
  private queue: Array<QueueItem<any>> = [];
  private processing = false;

  constructor() {
    super();
    this.rateLimiter = new RateLimiter({
      requestsPerMinute: config.anthropic.requestLimitPerMinute,
      inputTokensPerMinute: config.anthropic.inputTokenLimitPerMinute,
      outputTokensPerMinute: config.anthropic.outputTokenLimitPerMinute
    });

    this.maxConcurrentRequests = config.anthropic.maxConcurrentRequests ?? 2;
  }

  async execute<T>(task: () => Promise<T>, options: RequestOptions = {}): Promise<T> {
    const queueItem: QueueItem<T> = {
      execute: task,
      resolve: () => null,
      reject: () => null,
      enqueuedAt: Date.now(),
      priority: options.priority ?? 5,
      estimatedInputTokens: Math.max(0, options.estimatedInputTokens ?? 0),
      estimatedOutputTokens: Math.max(0, options.estimatedOutputTokens ?? 0),
      description: options.description,
      tags: options.tags,
      retryCount: 0,
      retryOn429: options.retryOn429 ?? true,
      chatGuid: options.chatGuid
    } as QueueItem<T>;

    const promise = new Promise<T>((resolve, reject) => {
      queueItem.resolve = resolve;
      queueItem.reject = reject;
    });

    this.queue.push(queueItem as QueueItem<any>);
    logDebug('Anthropic request enqueued', {
      priority: queueItem.priority,
      queueLength: this.queue.length,
      description: queueItem.description,
      tags: queueItem.tags
    });
    void this.processQueue();

    return promise;
  }

  private async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      while (this.queue.length > 0) {
        if (this.inFlight.size >= this.maxConcurrentRequests) {
          await this.awaitInFlightSlot();
          continue;
        }

        this.queue.sort((a, b) => a.priority - b.priority || a.enqueuedAt - b.enqueuedAt);
        const next = this.queue.shift()!;

        const executionPromise = this.executeWithPermit(next);
        this.inFlight.add(executionPromise);
        void executionPromise.finally(() => {
          this.inFlight.delete(executionPromise);
        });
      }
    } finally {
      this.processing = false;
    }
  }

  private async awaitInFlightSlot(): Promise<void> {
    await Promise.race(this.inFlight);
  }

  private async executeWithPermit<T>(item: QueueItem<T>): Promise<void> {
    const startTime = Date.now();
    let permit: ManagedPermit | null = null;

    // Emit request:start event for typing indicators
    if (item.chatGuid) {
      logInfo('AnthropicRequestManager: Emitting request:start', { chatGuid: item.chatGuid, description: item.description });
      this.emit('request:start', { chatGuid: item.chatGuid, description: item.description });
    } else {
      logDebug('AnthropicRequestManager: No chatGuid, skipping request:start event', { description: item.description });
    }

    try {
      permit = await this.rateLimiter.reserve(item.estimatedInputTokens, item.estimatedOutputTokens);
      const result = await item.execute();

      const usage = this.extractUsage(result);
      permit.complete(usage?.inputTokens, usage?.outputTokens);

      this.logSuccess(item, usage, Date.now() - startTime);
      item.resolve(result);
    } catch (error: any) {
      if (permit) {
        permit.complete(0, 0);
      }

      const retryInfo = this.getRetryInfo(error, item.retryCount);
      const shouldRetry = item.retryOn429 && retryInfo.shouldRetry && item.retryCount < DEFAULT_MAX_RETRIES;

      if (shouldRetry) {
        item.retryCount += 1;
        const delay = retryInfo.delayMs;
        logWarn('Anthropic request retry scheduled', {
          description: item.description,
          attempt: item.retryCount,
          delayMs: delay,
          error: error instanceof Error ? error.message : String(error)
        });

        // Don't emit request:end on retry - typing should continue
        await this.delay(delay);
        this.queue.push(item);
        return;
      }

      if (this.isRateLimitError(error)) {
        void this.notifyRateLimitFailure(item, error);
      }

      this.logFailure(item, error, Date.now() - startTime);
      item.reject(error);
    } finally {
      // Emit request:end event for typing indicators (except on retry which returns early)
      if (item.chatGuid) {
        this.emit('request:end', { chatGuid: item.chatGuid, description: item.description });
      }
    }
  }

  private getRetryInfo(error: any, attempt: number): { shouldRetry: boolean; delayMs: number } {
    const status = error?.status ?? error?.response?.status;
    const isRateLimit = status === 429
      || error?.error?.type === 'rate_limit_error'
      || typeof error?.message === 'string' && error.message.includes('rate_limit');

    if (!isRateLimit) {
      return { shouldRetry: false, delayMs: 0 };
    }

    const retryAfter = error?.response?.headers?.['retry-after']
      ?? error?.headers?.['retry-after']
      ?? error?.response?.headers?.get?.('retry-after');

    if (retryAfter) {
      const retrySeconds = parseFloat(retryAfter);
      if (!Number.isNaN(retrySeconds) && retrySeconds > 0) {
        return {
          shouldRetry: true,
          delayMs: retrySeconds * 1000
        };
      }
    }

    return {
      shouldRetry: true,
      delayMs: BASE_RETRY_DELAY_MS * Math.pow(2, attempt)
    };
  }

  private extractUsage(result: unknown): { inputTokens?: number; outputTokens?: number } | undefined {
    if (!result || typeof result !== 'object') {
      return undefined;
    }

    const usage = (result as any).usage
      ?? (result as any).data?.metadata?.usage
      ?? (result as any).metadata?.usage;

    if (!usage) {
      return undefined;
    }

    return {
      inputTokens: usage.input_tokens ?? usage.inputTokens,
      outputTokens: usage.output_tokens ?? usage.outputTokens
    };
  }

  private logSuccess(
    item: QueueItem<any>,
    usage: { inputTokens?: number; outputTokens?: number } | undefined,
    durationMs: number
  ): void {
    logInfo('Anthropic request completed', {
      description: item.description,
      tags: item.tags,
      durationMs,
      queueLength: this.queue.length,
      retryCount: item.retryCount,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens
    });
  }

  private logFailure(item: QueueItem<any>, error: unknown, durationMs: number): void {
    logError('Anthropic request failed', error, {
      description: item.description,
      tags: item.tags,
      durationMs,
      retryCount: item.retryCount
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private isRateLimitError(error: any): boolean {
    const status = error?.status ?? error?.response?.status;
    return status === 429
      || error?.error?.type === 'rate_limit_error'
      || typeof error?.message === 'string' && error.message.toLowerCase().includes('rate_limit');
  }

  private async notifyRateLimitFailure(item: QueueItem<any>, error: any): Promise<void> {
    try {
      const messageParts = [
        'Grace hit the Anthropic rate limit and exhausted retries.',
        item.description ? `Task: ${item.description}` : undefined,
        `Attempts: ${item.retryCount + 1}`,
        error?.message ? `Error: ${error.message}` : undefined
      ].filter(Boolean);

      await this.notifier.sendAdminAlert(messageParts.join(' \n'));
    } catch (notifyError) {
      logWarn('Failed to dispatch rate limit alert', {
        error: notifyError instanceof Error ? notifyError.message : String(notifyError)
      });
    }
  }
}

let requestManagerInstance: AnthropicRequestManager | null = null;

export const getAnthropicRequestManager = (): AnthropicRequestManager => {
  if (!requestManagerInstance) {
    requestManagerInstance = new AnthropicRequestManager();
  }

  return requestManagerInstance;
};
