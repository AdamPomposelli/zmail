import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { CompletionRequest, LlmClient } from '../src/ai/providers';

/**
 * Apple Intelligence for benchmarks, without ZMail.app: a small Swift tool (bench/apple/main.swift)
 * runs FoundationModels the way the app's bridge does, and this client talks to it like
 * AppleClient talks to the bridge (same system-prompt suffix, same temperature).
 */
export class AppleCliClient implements LlmClient {
  readonly id = 'apple';
  readonly label = 'Apple Intelligence';
  readonly model = 'apple-on-device';
  private child: ChildProcessWithoutNullStreams;
  private next = 1;
  private pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();

  constructor() {
    const binary = join(tmpdir(), 'zmail-apple-bench');
    if (!existsSync(binary)) execFileSync('swiftc', ['-O', join(import.meta.dirname, 'apple/main.swift'), '-o', binary], { stdio: 'inherit' });
    this.child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.on('data', (d) => process.stderr.write(d));
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      const reply = JSON.parse(line) as { id: number; text?: string; error?: string };
      const waiter = this.pending.get(reply.id);
      this.pending.delete(reply.id);
      if (reply.text !== undefined && reply.text !== null) waiter?.resolve(reply.text);
      else waiter?.reject(new Error(reply.error ?? 'Apple Intelligence: no answer'));
    });
  }

  complete(request: CompletionRequest): Promise<{ text: string; usage?: { promptTokens: number; completionTokens: number } }> {
    const id = this.next++;
    const system = request.json ? `${request.system}\nRéponds uniquement avec un objet JSON valide, sans texte autour.` : request.system;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: (text) => resolve({ text }), reject });
      this.child.stdin.write(`${JSON.stringify({ id, system, prompt: request.prompt, temperature: request.temperature ?? 0.2, maxTokens: request.maxTokens })}\n`);
    });
  }

  close() {
    this.child.stdin.end();
  }
}
