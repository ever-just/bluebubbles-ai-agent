import { logDebug } from '../utils/logger';

interface RateLimiterConfig {
  requestsPerMinute?: number;
  inputTokensPerMinute?: number;
  outputTokensPerMinute?: number;
}

export interface ManagedPermit {
  complete: (actualInputTokens?: number, actualOutputTokens?: number) => void;
}

interface ReserveTiming {
  nextAvailable: number;
  inputTokensAvailable: number;
  outputTokensAvailable: number;
}

/**
 * Rate limiter enforcing Anthropic request + token quotas.
 */
export class RateLimiter {
  private readonly requestsPerMinute: number;
  private readonly inputTokensPerMinute: number;
  private readonly outputTokensPerMinute: number;

  private readonly requestTimestamps: number[] = [];
  private readonly inputUsage: number[] = [];
  private readonly outputUsage: number[] = [];

  constructor(config: RateLimiterConfig) {
    this.requestsPerMinute = config.requestsPerMinute ?? 30;
    this.inputTokensPerMinute = config.inputTokensPerMinute ?? 120000;
    this.outputTokensPerMinute = config.outputTokensPerMinute ?? 40000;
  }

  async reserve(estimatedInputTokens: number, estimatedOutputTokens: number): Promise<ManagedPermit> {
    while (true) {
      const now = Date.now();
      this.trimHistory(now);

      const timing = this.getReserveTiming(now, estimatedInputTokens, estimatedOutputTokens);
      if (timing.nextAvailable <= now) {
        this.recordReservation(now, estimatedInputTokens, estimatedOutputTokens);
        logDebug('Rate limiter permit granted', {
          estimatedInputTokens,
          estimatedOutputTokens,
          requestWindow: this.requestTimestamps.length
        });

        return {
          complete: (actualInputTokens?: number, actualOutputTokens?: number) => {
            this.recordCompletion(actualInputTokens ?? estimatedInputTokens, actualOutputTokens ?? estimatedOutputTokens);
          }
        };
      }

      const delayMs = timing.nextAvailable - now;
      logDebug('Rate limiter waiting for capacity', { delayMs });
      await this.delay(delayMs);
    }
  }

  private recordReservation(timestamp: number, inputTokens: number, outputTokens: number): void {
    this.requestTimestamps.push(timestamp);
    this.inputUsage.push(inputTokens);
    this.outputUsage.push(outputTokens);
  }

  private recordCompletion(inputTokens: number, outputTokens: number): void {
    this.inputUsage[this.inputUsage.length - 1] = inputTokens;
    this.outputUsage[this.outputUsage.length - 1] = outputTokens;
  }

  private trimHistory(now: number): void {
    const cutoff = now - 60000;

    while (this.requestTimestamps.length && this.requestTimestamps[0] < cutoff) {
      this.requestTimestamps.shift();
      this.inputUsage.shift();
      this.outputUsage.shift();
    }
  }

  private getReserveTiming(now: number, estimatedInput: number, estimatedOutput: number): ReserveTiming {
    const requestCapacity = this.requestsPerMinute > 0 ? this.requestsPerMinute : Infinity;
    const inputCapacity = this.inputTokensPerMinute > 0 ? this.inputTokensPerMinute : Infinity;
    const outputCapacity = this.outputTokensPerMinute > 0 ? this.outputTokensPerMinute : Infinity;

    const requestUsage = this.requestTimestamps.length;
    const inputUsage = this.inputUsage.reduce((sum, v) => sum + v, 0);
    const outputUsage = this.outputUsage.reduce((sum, v) => sum + v, 0);

    let nextAvailable = now;

    if (requestUsage >= requestCapacity) {
      const oldest = this.requestTimestamps[0];
      nextAvailable = Math.max(nextAvailable, oldest + 60000);
    }

    if (inputUsage + estimatedInput > inputCapacity) {
      const deficit = inputUsage + estimatedInput - inputCapacity;
      const perTokenWindow = 60000 / inputCapacity;
      nextAvailable = Math.max(nextAvailable, now + deficit * perTokenWindow);
    }

    if (outputUsage + estimatedOutput > outputCapacity) {
      const deficit = outputUsage + estimatedOutput - outputCapacity;
      const perTokenWindow = 60000 / outputCapacity;
      nextAvailable = Math.max(nextAvailable, now + deficit * perTokenWindow);
    }

    return {
      nextAvailable,
      inputTokensAvailable: Math.max(0, this.inputTokensPerMinute - inputUsage),
      outputTokensAvailable: Math.max(0, this.outputTokensPerMinute - outputUsage)
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
