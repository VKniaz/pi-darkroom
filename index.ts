import { getLanguageFromPath, type ExtensionAPI, type Theme } from '@earendil-works/pi-coding-agent';
import { Container, Text, type Component } from '@earendil-works/pi-tui';
import { highlightCommand } from './highlight.mjs';
import { codeCard } from './code-cards.ts';
import { markdownCodeCards } from './markdown.ts';
import { syntaxCode, shellFileCommands } from './syntax.ts';

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
  pi.registerCommand('command-colors', {
    description: 'Check whether completed command colors are loaded',
    handler: async (_args, context) => {
      context.ui.notify('Command colors: enabled. Gray code cards; consistent shell-command colors; plain unknown code; red failure labels.', 'info');
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
        if (context.isError) {
          const failed = new Container();
          failed.addChild(new Text(theme.fg('error', '✗ Failed'), 0, 0));
          failed.addChild(displayed);
          displayed = failed;
        }
        if (displayed !== component) nativeComponents.set(displayed, component);
        return displayed;
      },
      ...((name === 'read' || name === 'edit') && original.renderResult ? {
        renderResult(result, options, theme, context) {
          const previous = context.lastComponent && nativeComponents.get(context.lastComponent);
          const nativeContext = previous ? { ...context, lastComponent: previous } : context;
          const component = original.renderResult!(result, options, theme, nativeContext);
          const hasImage = result.content.some(part => part.type === 'image');
          const source = name === 'read' ? result.content.some(part => part.type === 'text') : typeof result.details?.diff === 'string';
          if (original.renderShell === 'self' || context.isError || hasImage || !source) return component;
          const input = (context.args && typeof context.args === 'object' ? context.args : {}) as Record<string, unknown>;
          const shellFile = name === 'read' && typeof input.path === 'string' && getLanguageFromPath(input.path) === 'bash';
          const displayed = codeCard(shellFile ? shellFileCommands(component, theme) : component, theme);
          nativeComponents.set(displayed, component);
          return displayed;
        },
      } : {}),
    };
  });
}
