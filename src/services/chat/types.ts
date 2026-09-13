import { type FetchSSEOptions } from '@lobechat/fetch-sse';
import {
  type RuntimeInitialContext,
  type RuntimeStepContext,
  type TracePayload,
} from '@lobechat/types';

export interface FetchOptions extends FetchSSEOptions {
  agentId?: string;
  historySummary?: string;
  /** Initial context for page editor (captured at operation start) */
  initialContext?: RuntimeInitialContext;
  signal?: AbortSignal | undefined;
  /** Step context for page editor (updated each step) */
  stepContext?: RuntimeStepContext;
  /**
   * `'preset'` marks system completions (topic auto-title, agent meta) with
   * the `x-webgpt-task` header so the billing gate excludes them from the
   * free daily message quota (EXP-003).
   */
  task?: 'preset';
  topicId?: string;
  trace?: TracePayload;
}
