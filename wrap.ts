import { visibleWidth, wrapTextWithAnsi, type Component } from '@earendil-works/pi-tui';

const HANGING_INDENT = 2;

function leadingSpaces(line: string) {
  return /^ */.exec(line.replace(/\x1b\[[0-9;]*m/g, ''))![0].length;
}

/** Continuation rows of a wrapped line sit two columns right of the line's own indentation. */
export function wrapWithHangingIndent(line: string, width: number) {
  if (visibleWidth(line) <= width) return [line];
  const indent = Math.min(leadingSpaces(line) + HANGING_INDENT, Math.floor(width / 3));
  const [first, ...rest] = wrapTextWithAnsi(line, width - indent);
  return [first, ...rest.map(part => ' '.repeat(indent) + part)];
}

export class HangingText implements Component {
  private cached?: { width: number; lines: string[] };

  constructor(private readonly text: string) {}

  render(width: number) {
    if (this.cached?.width !== width) {
      const lines = this.text.replace(/\t/g, '   ').split('\n').flatMap(line => wrapWithHangingIndent(line, width));
      this.cached = { width, lines };
    }
    return this.cached.lines;
  }

  invalidate() {
    this.cached = undefined;
  }
}
