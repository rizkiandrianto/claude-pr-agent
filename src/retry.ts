/**
 * Retry utilities with exponential backoff
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  retryableErrors?: (error: any) => boolean;
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffMultiplier = 2,
    retryableErrors = () => true
  } = options;

  let lastError: any;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry if error is not retryable
      if (!retryableErrors(error)) {
        throw error;
      }

      // Don't retry if max retries reached
      if (attempt >= maxRetries) {
        break;
      }

      console.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, String(error));

      // Wait before retrying
      await sleep(delay);

      // Exponential backoff with max delay
      delay = Math.min(delay * backoffMultiplier, maxDelay);
    }
  }

  throw lastError;
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Rate limiter to prevent excessive API calls
 */
export class RateLimiter {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(
    private maxConcurrent: number = 3,
    private minDelay: number = 100
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Wait for available slot
    while (this.running >= this.maxConcurrent) {
      await new Promise(resolve => this.queue.push(resolve as () => void));
    }

    this.running++;

    try {
      const result = await fn();
      await sleep(this.minDelay); // Minimum delay between calls
      return result;
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

/**
 * Check if an error is retryable (network errors, rate limits, etc.)
 */
export function isRetryableError(error: any): boolean {
  const message = String(error?.message || error).toLowerCase();

  // Network errors
  if (message.includes("econnreset") || message.includes("enotfound") || message.includes("etimedout")) {
    return true;
  }

  // HTTP status codes that are retryable
  const status = error?.status || error?.statusCode;
  if (status === 429 || status === 502 || status === 503 || status === 504) {
    return true;
  }

  return false;
}
