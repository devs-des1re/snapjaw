export class TokenBucket {
  private tokens: number;
  private last = Date.now();
  private chain: Promise<void> = Promise.resolve();

  constructor(
    readonly rate: number,
    private readonly capacity: number,
  ) {
    this.tokens = capacity;
  }

  private refill() {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
  }

  take(): Promise<void> {
    const next = this.chain.then(async () => {
      this.refill();
      if (this.tokens < 1) {
        const wait = Math.ceil(((1 - this.tokens) / this.rate) * 1000);
        await new Promise((resolve) => setTimeout(resolve, wait));
        this.refill();
      }
      this.tokens -= 1;
    });
    this.chain = next.catch(() => undefined);
    return next;
  }
}
