import type { Theme } from '@earendil-works/pi-coding-agent';
import { Box, rgbColor, type Component } from '@earendil-works/pi-tui';

const DARK_BACKGROUND = rgbColor(37, 38, 42);
const LIGHT_BACKGROUND = rgbColor(243, 244, 246);

export function paintCodeLine(text: string, theme: Theme) {
  return theme.style(text, { bg: theme.appearance === 'light' ? LIGHT_BACKGROUND : DARK_BACKGROUND });
}

export function codeCard(component: Component, theme: Theme) {
  const box = new Box(1, 1, text => paintCodeLine(text, theme));
  box.addChild(component);
  return box;
}
