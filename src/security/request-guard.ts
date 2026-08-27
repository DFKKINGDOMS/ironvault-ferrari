export interface RequestPermit {
  release(): void;
}

export class RequestLimitError extends Error {
  constructor(
    message: string,
    readonly code: 'RATE_LIMITED' | 'CONCURRENCY_LIMITED',
    readonly retryAfterSeconds: number
  ) {
    super(message);
  }
}

interface WindowEntry {
  openedAt: number;
  count: number;
}

export class RequestGuard {
  private readonly windows = new Map<string, WindowEntry>();
  private active = 0;

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly maxConcurrency: number,
    private readonly clock: () => number = Date.now
  ) {}

  acquire(key: string): RequestPermit {
    const timestamp = this.clock();
    const current = this.windows.get(key);
    const entry = !current || timestamp - current.openedAt >= this.windowMs
      ? { openedAt: timestamp, count: 0 }
      : current;
    if (entry.count >= this.maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.openedAt + this.windowMs - timestamp) / 1_000));
      throw new RequestLimitError('request rate limit reached', 'RATE_LIMITED', retryAfterSeconds);
    }
    if (this.active >= this.maxConcurrency) {
      throw new RequestLimitError('request concurrency limit reached', 'CONCURRENCY_LIMITED', 1);
    }
    entry.count += 1;
    this.windows.set(key, entry);
    this.active += 1;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.active = Math.max(0, this.active - 1);
      }
    };
  }
}
