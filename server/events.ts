import type { Response } from 'express';

export type EventName = 'repo:update' | 'state:changed' | 'toast' | 'ping';

export class EventHub {
  private clients = new Set<Response>();
  private timer: NodeJS.Timeout | null = null;

  subscribe(res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(`retry: 2000\n\n`);
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
    if (!this.timer) {
      this.timer = setInterval(() => this.broadcast('ping', { t: Date.now() }), 25_000);
      this.timer.unref();
    }
  }

  broadcast(event: EventName, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.clients) {
      try {
        res.write(payload);
      } catch {
        this.clients.delete(res);
      }
    }
  }

  size(): number {
    return this.clients.size;
  }

  close(): void {
    for (const res of this.clients) res.end();
    this.clients.clear();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
