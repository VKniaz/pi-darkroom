import { highlightCode, type Theme } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import { tintCliLines } from './cli-words.mjs';

function commandColors(lines: readonly string[], theme: Theme) {
  return tintCliLines(lines, {
    paint: word => theme.fg('syntaxKeyword', word),
    ignoredForegrounds: [theme.getFgAnsi('syntaxString'), theme.getFgAnsi('syntaxComment')],
  });
}

export function syntaxCode(source: string, language: string, theme: Theme) {
  const lines = highlightCode(source, language);
  return language === 'bash' ? commandColors(lines, theme) : lines;
}

export function shellFileCommands(component: Component, theme: Theme): Component {
  return {
    render(width) {
      const lines = component.render(width);
      try { return commandColors(lines, theme); }
      catch { return lines; }
    },
    invalidate() { component.invalidate(); },
    handleMouse: component.handleMouse?.bind(component),
  };
}
