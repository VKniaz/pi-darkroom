import { copyToClipboard, getLanguageFromPath, type ExtensionAPI, type Theme } from '@earendil-works/pi-coding-agent';
import { Container, Text, type Component } from '@earendil-works/pi-tui';
import { highlightCommand } from './highlight.mjs';
import { codeCard } from './code-cards.ts';
import { markdownCodeCards } from './markdown.ts';
import { syntaxCode, shellFileCommands } from './syntax.ts';
import { EditDiffCard, DiffResultCard } from './diff.ts';
import { compactBashSummary } from './compact.ts';
import { loadSettings, saveSettings } from './settings.ts';
import { pickCodeBlock } from './copy-code.mjs';

const MAX_HIGHLIGHT_CHARACTERS = 50_000;
type HighlightCache = { command: string; colors: object; mode: string; body: string };

function colorCommand(component: Text, command: string, timeout: unknown, theme: Theme,
  cache: WeakMap<Text, HighlightCache>) {
  const colors = theme.colors;
  const mode = theme.getColorMode();
  let formatted = cache.get(component);
  if (!formatted || formatted.command !== command || formatted.colors !== colors || formatted.mode !== mode) {
    const body = highlightCommand(command, (source, language) => syntaxCode(source, language, theme)).map(line => theme.fg('text', line)).join('\n');
    formatted = { command, colors, mode, body };
    cache.set(component, formatted);
  }
  const suffix = timeout ? theme.fg('muted', ` (timeout ${timeout}s)`) : '';
  component.setText(theme.fg('toolTitle', '$ ') + formatted.body + suffix);
}

export default function completedCommandColors(pi: ExtensionAPI) {
  const cache = new WeakMap<Text, HighlightCache>();
  const nativeComponents = new WeakMap<Component, Component>();
  let themeSource: (() => Theme) | undefined;
  pi.on('session_start', (_event, context) => {
    if (context.mode !== 'tui') return;
    const ui = context.ui;
    themeSource = () => ui.theme;
  });
  pi.registerMarkdownTransformer((markdown, context) => {
    const theme = themeSource?.();
    return theme ? markdownCodeCards(markdown, context, theme) : markdown;
  }, { messageTypes: ['user', 'assistant', 'assistant-thinking', 'custom'] });
  const settings = loadSettings();
  pi.registerCommand('command-colors', {
    description: 'Show renderer status, or switch compact tool rows: /command-colors compact on|off',
    handler: async (args, context) => {
      const [option, value] = args.trim().toLowerCase().split(/\s+/);
      if (option === 'compact' && (value === 'on' || value === 'off')) {
        settings.compactTools = value === 'on';
        saveSettings(settings);
        context.ui.notify(`Compact tool rows: ${value}. Expand any row with the tool-expand key.`, 'info');
        return;
      }
      context.ui.notify('Command colors: enabled. Code and diff cards; consistent shell-command colors; red failure labels. '
        + `Compact tool rows: ${settings.compactTools ? 'on' : 'off'} (/command-colors compact on|off).`, 'info');
    },
  });
  pi.registerCommand('copy-code', {
    description: 'Copy the exact source of the latest code block (or /copy-code 2 for the one before)',
    handler: async (args, context) => {
      const text = args.trim();
      const position = text === '' ? 1 : Number(text);
      if (!Number.isInteger(position) || position < 1) {
        context.ui.notify('Usage: /copy-code [n] — n = 1 for the latest code block, 2 for the one before, …', 'warning');
        return;
      }
      const block = pickCodeBlock(context.sessionManager.getBranch(), position);
      if (!block) {
        context.ui.notify(position === 1 ? 'No code block to copy yet.' : `No code block #${position} — fewer code blocks in this conversation.`, 'warning');
        return;
      }
      await copyToClipboard(block.code);
      const lines = block.code.split('\n').length;
      context.ui.notify(`Copied ${block.language || 'code'} block (${lines} line${lines === 1 ? '' : 's'}) to the clipboard.`, 'info');
    },
  });
  pi.registerToolRenderer((name, next) => {
    const original = next();
    if (!original?.renderCall) return original;
    return {
      ...original,
      renderCall(args, theme, context) {
        const previous = context.lastComponent && nativeComponents.get(context.lastComponent);
        const nativeContext = previous ? { ...context, lastComponent: previous } : context;
        const component = original.renderCall!(args, theme, nativeContext);
        const input = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
        const command = input.command;
        if (name === 'bash' && context.argsComplete && component instanceof Text &&
            typeof command === 'string' && command && command.length <= MAX_HIGHLIGHT_CHARACTERS) {
          try {
            colorCommand(component, command, input.timeout, theme, cache);
          } catch {
            // A display failure must preserve the native command, not hide it or affect execution.
          }
        }
        const source = name === 'bash' && component instanceof Text ? input.command : name === 'write' ? input.content : name === 'codemode' ? input.code : undefined;
        const shellFile = name === 'write' && context.argsComplete && typeof input.path === 'string' && getLanguageFromPath(input.path) === 'bash';
        const content = shellFile && original.renderShell !== 'self' ? shellFileCommands(component, theme) : component;
        let displayed: Component = original.renderShell !== 'self' && typeof source === 'string' && source.length ? codeCard(content, theme) : content;
        if (name === 'edit' && EditDiffCard.supports(component)) {
          displayed = new EditDiffCard(component, theme, typeof input.path === 'string' ? input.path : undefined, context.outputPad);
        }
        if (context.isError) {
          const failed = new Container();
          failed.addChild(new Text(theme.fg('error', '✗ Failed'), 0, 0));
          failed.addChild(displayed);
          displayed = failed;
        }
        if (displayed !== component) nativeComponents.set(displayed, component);
        return displayed;
      },
      ...(['read', 'edit', 'bash'].includes(name) && original.renderResult ? {
        renderResult(result, options, theme, context) {
          const previous = context.lastComponent && nativeComponents.get(context.lastComponent);
          const nativeContext = previous ? { ...context, lastComponent: previous } : context;
          const component = original.renderResult!(result, options, theme, nativeContext);
          if (original.renderShell === 'self' || context.isError) return component;
          const input = (context.args && typeof context.args === 'object' ? context.args : {}) as Record<string, unknown>;
          const path = typeof input.path === 'string' ? input.path : undefined;
          let displayed: Component = component;
          if (name === 'bash') {
            if (settings.compactTools && !options.expanded && !options.isPartial) {
              displayed = compactBashSummary(result, context.durationMs, theme, context.keyText('app.tools.expand'));
            }
          } else if (name === 'edit') {
            const diff = (result.details as { diff?: unknown } | undefined)?.diff;
            const shown = (component as { children?: unknown[] }).children?.length;
            if (typeof diff === 'string' && shown) displayed = new DiffResultCard(diff, theme, path);
          } else if (!result.content.some(part => part.type === 'image') && result.content.some(part => part.type === 'text')) {
            const shellFile = path !== undefined && getLanguageFromPath(path) === 'bash';
            displayed = codeCard(shellFile ? shellFileCommands(component, theme) : component, theme);
          }
          if (displayed !== component) nativeComponents.set(displayed, component);
          return displayed;
        },
      } : {}),
    };
  });
}
