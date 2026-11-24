import type { Theme } from '@earendil-works/pi-coding-agent';
import { rgbColor } from '@earendil-works/pi-tui';

const READABLE_WHITE = rgbColor(230, 232, 237);
const UUID = String.raw`[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}`;
const DATE = String.raw`\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])`;
const TIME = String.raw`(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?`;
const ZONE = String.raw`(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d|[ ](?:UTC|GMT))?`;
const DATA_TOKEN = new RegExp(String.raw`(?<![A-Za-z0-9_])(?:${UUID}|${DATE}(?:[T ]${TIME}${ZONE})?|${TIME}${ZONE})(?![A-Za-z0-9_])`, 'gi');

export function plainTextLines(source: string, theme: Theme) {
  const body = (text: string) => theme.appearance === 'light'
    ? theme.fg('text', text) : theme.style(text, { fg: READABLE_WHITE });
  return source.split('\n').map(line => {
    let rendered = '', offset = 0;
    for (const match of line.matchAll(DATA_TOKEN)) {
      rendered += body(line.slice(offset, match.index));
      rendered += theme.fg('syntaxKeyword', match[0]);
      offset = match.index + match[0].length;
    }
    return rendered + body(line.slice(offset));
  });
}
