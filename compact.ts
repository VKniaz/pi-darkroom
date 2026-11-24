import type { Theme } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';

type BashResult = { content: Array<{ type: string; text?: string }>; details?: { truncation?: { truncated?: boolean } } };

function duration(ms: number | undefined) {
  if (ms === undefined) return '';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** `expandKey` is the user's configured tool-expand key; empty when unbound, so no hint is shown. */
export function compactBashSummary(result: BashResult, durationMs: number | undefined, theme: Theme, expandKey: string) {
  const output = result.content.filter(part => part.type === 'text').map(part => part.text ?? '').join('\n').trim();
  const count = output ? output.split('\n').length : 0;
  const parts = [count ? `${count} line${count === 1 ? '' : 's'}` : 'no output'];
  if (durationMs !== undefined) parts.push(duration(durationMs));
  if (result.details?.truncation?.truncated) parts.push('truncated');
  const hint = count && expandKey ? ' ' + theme.fg('muted', `(${expandKey} to expand)`) : '';
  return new Text(theme.fg('success', '✓') + ' ' + theme.fg('muted', parts.join(' · ')) + hint, 0, 0);
}
