import { getLanguageFromPath, highlightCode, type Theme } from '@earendil-works/pi-coding-agent';
import { backgroundAnsi, rgbColor, visibleWidth, wrapTextWithAnsi, type Color, type Component } from '@earendil-works/pi-tui';
import { highlightCommand } from './highlight.mjs';
import { syntaxCode } from './syntax.ts';

type Kind = 'context' | 'added' | 'removed' | 'gap';
type DiffLine = { kind: Kind; number: string; content: string; text?: string; emphasis?: [number, number] };
type Palette = { card: Color; added: Color; removed: Color; addedStrong: Color; removedStrong: Color };

const DARK: Palette = {
  card: rgbColor(37, 38, 42), added: rgbColor(39, 56, 44), removed: rgbColor(62, 40, 42),
  addedStrong: rgbColor(52, 82, 60), removedStrong: rgbColor(95, 52, 55),
};
const LIGHT: Palette = {
  card: rgbColor(243, 244, 246), added: rgbColor(226, 243, 230), removed: rgbColor(250, 228, 228),
  addedStrong: rgbColor(196, 230, 204), removedStrong: rgbColor(244, 196, 196),
};
// Same line format Pi's native diff renderer parses: sign, padded line number, space, content.
const LINE = /^([+-\s])(\s*\d*)\s(.*)$/;
const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/y;
const MAX_HIGHLIGHT_CHARACTERS = 50_000;

function parse(diff: string): DiffLine[] {
  return diff.split('\n').map(line => {
    const match = LINE.exec(line);
    if (!match) return { kind: 'gap', number: '', content: line };
    const kind = match[1] === '+' ? 'added' : match[1] === '-' ? 'removed' : 'context';
    return { kind, number: match[2].trim(), content: match[3].replace(/\t/g, '   ') };
  });
}

function highlightSide(lines: DiffLine[], language: string, theme: Theme) {
  const source = lines.map(line => line.content).join('\n');
  const colored = language === 'bash'
    ? highlightCommand(source, (code, lang) => syntaxCode(code, lang, theme))
    : highlightCode(source, language);
  if (colored.length !== lines.length) return;
  lines.forEach((line, index) => { line.text = colored[index]; });
}

function markSingleLineChanges(lines: DiffLine[]) {
  for (let index = 0; index + 1 < lines.length; index++) {
    const [removed, added] = [lines[index], lines[index + 1]];
    const isPair = removed.kind === 'removed' && added.kind === 'added'
      && lines[index - 1]?.kind !== 'removed' && lines[index + 2]?.kind !== 'added';
    if (!isPair) continue;
    let prefix = 0;
    while (prefix < removed.content.length && removed.content[prefix] === added.content[prefix]) prefix++;
    let suffix = 0;
    while (suffix < removed.content.length - prefix && suffix < added.content.length - prefix
      && removed.content.at(-1 - suffix) === added.content.at(-1 - suffix)) suffix++;
    if (removed.content.length - suffix > prefix) removed.emphasis = [prefix, removed.content.length - suffix];
    if (added.content.length - suffix > prefix) added.emphasis = [prefix, added.content.length - suffix];
  }
}

function emphasize(text: string, [start, end]: [number, number], open: string, restore: string) {
  let visible = 0, result = '';
  for (let offset = 0; offset < text.length;) {
    ANSI.lastIndex = offset;
    const escape = ANSI.exec(text);
    if (escape) { result += escape[0]; offset += escape[0].length; continue; }
    if (visible === start) result += open;
    result += text[offset++];
    if (++visible === end) result += restore;
  }
  return result;
}

export function diffCardLines(diff: string, path: string | undefined, width: number, theme: Theme): string[] {
  if (width < 8) return diff.split('\n');
  const palette = theme.appearance === 'light' ? LIGHT : DARK;
  const mode = theme.getColorMode();
  const lines = parse(diff);
  const language = path ? getLanguageFromPath(path) : undefined;
  if (language && diff.length <= MAX_HIGHLIGHT_CHARACTERS) {
    try {
      highlightSide(lines.filter(line => line.kind === 'context' || line.kind === 'added'), language, theme);
      highlightSide(lines.filter(line => line.kind === 'removed'), language, theme);
    } catch {
      // Unhighlighted content is still a complete, readable diff.
    }
  }
  markSingleLineChanges(lines);
  const digits = Math.max(1, ...lines.map(line => line.number.length));
  const inner = width - 2;
  const out = [theme.style(' '.repeat(width), { bg: palette.card })];
  for (const line of lines) {
    const background = line.kind === 'added' ? palette.added : line.kind === 'removed' ? palette.removed : palette.card;
    const strong = line.kind === 'added' ? palette.addedStrong : palette.removedStrong;
    const sign = line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' ';
    const gutterColor = line.kind === 'added' ? 'toolDiffAdded' : line.kind === 'removed' ? 'toolDiffRemoved' : 'dim';
    const gutter = line.kind === 'gap' ? '' : theme.fg(gutterColor, sign + line.number.padStart(digits)) + ' ';
    let body = line.text ?? theme.fg(line.kind === 'context' || line.kind === 'gap' ? 'toolDiffContext' : 'text', line.content);
    if (line.emphasis) body = emphasize(body, line.emphasis, backgroundAnsi(strong, mode), backgroundAnsi(background, mode));
    for (const part of wrapTextWithAnsi(gutter + body, inner)) {
      const padding = ' '.repeat(Math.max(0, inner - visibleWidth(part)));
      out.push(theme.style(' ', { bg: palette.card }) + theme.style(part + padding, { bg: background })
        + theme.style(' ', { bg: palette.card }));
    }
  }
  out.push(theme.style(' '.repeat(width), { bg: palette.card }));
  return out;
}

type NativeEditCall = Component & {
  preview?: { diff?: string; error?: string };
  children?: Component[];
  bgFn?: (text: string) => string;
};

/**
 * Replaces the diff body of Pi's self-framed edit row. It reads the native row's preview state at render time,
 * so asynchronous preview updates appear on the next frame, and it keeps the native frame padding and header
 * background so themes that color edit headers still do.
 */
export class EditDiffCard implements Component {
  private cache?: { key: string; lines: string[] };
  constructor(private readonly native: NativeEditCall, private readonly theme: Theme,
    private readonly path: string | undefined, private readonly pad: number) {}

  static supports(component: Component): component is NativeEditCall {
    return 'preview' in component && Array.isArray((component as NativeEditCall).children);
  }

  render(width: number): string[] {
    const preview = this.native.preview;
    const header = this.native.children?.[0];
    const inner = width - this.pad * 2;
    if (!preview || typeof preview.diff !== 'string' || !header || inner < 8) return [...this.native.render(width)];
    const key = [width, this.pad, preview.diff, this.theme.getColorMode(), this.theme.colors.text].join('\0');
    if (this.cache?.key === key) return this.cache.lines;
    const frame = this.native.bgFn ?? ((text: string) => text);
    const side = ' '.repeat(this.pad);
    const framed = (line: string) => frame(side + line + ' '.repeat(Math.max(0, inner - visibleWidth(line))) + side);
    const lines = [
      framed(''), ...header.render(inner).map(framed), framed(''),
      ...diffCardLines(preview.diff, this.path, inner, this.theme).map(line => side + line + side),
      framed(''),
    ];
    this.cache = { key, lines };
    return lines;
  }

  invalidate() {
    this.cache = undefined;
    this.native.invalidate();
  }
}

export class DiffResultCard implements Component {
  constructor(private readonly diff: string, private readonly theme: Theme, private readonly path?: string) {}
  render(width: number) { return ['', ...diffCardLines(this.diff, this.path, width, this.theme)]; }
  invalidate() {}
}
