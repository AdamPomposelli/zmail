import { EventEmitter } from 'node:events';

/** Server → UI live events, streamed over /api/events (SSE). */
export type EngineEvent =
  | { type: 'sync'; accountId: string; status: string; error?: string | null }
  | { type: 'mail'; reason: 'new' | 'changed' | 'triaged' | 'folders'; threadIds: string[] }
  | { type: 'suggestion'; id: string }
  | { type: 'notification'; id: string; kind: string; title: string; body: string; otp?: string | null; threadId?: string | null }
  | { type: 'unsubscribe'; id: string; status: string; fromEmail: string }
  /** Progress of a prompt evaluation or improvement in the advanced AI settings. */
  | { type: 'lab'; phase: string; done: number; total: number };

class Bus extends EventEmitter {
  emitEvent(event: EngineEvent) {
    this.emit('event', event);
  }
  onEvent(listener: (event: EngineEvent) => void) {
    this.on('event', listener);
    return () => this.off('event', listener);
  }
}

export const bus = new Bus();
bus.setMaxListeners(100);
