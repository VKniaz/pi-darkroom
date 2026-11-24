import { getLanguageFromPath, highlightCode, type Theme, type MarkdownTransformContext } from '@earendil-works/pi-coding-agent';
import { visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';
import { paintCodeLine } from './code-cards.ts';
import { highlightCommand } from './highlight.mjs';
import { syntaxCode } from './syntax.ts';
import { plainTextLines } from './plain-text.ts';

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  javascript: 'js', typescript: 'ts', python: 'py', bash: 'sh', shell: 'sh',
  rust: 'rs', ruby: 'rb', csharp: 'cs', 'c#': 'cs', 'c++': 'cpp', kotlin: 'kt',
};

function languageFromInfo(info: string) {
  const tag = info.trim().split(/\s+/)[0].toLowerCase();
  if (!tag) return undefined;
  return getLanguageFromPath(tag) ?? getLanguageFromPath('snippet.' + (LANGUAGE_EXTENSIONS[tag] ?? tag));
}

function cardLines(source: string, info: string, width: number, streaming: boolean, theme: Theme) {
  const language = languageFromInfo(info);
  const lines = !streaming && language && source.length <= 50_000
    ? (language === 'bash' ? highlightCommand(source, (code, lang) => syntaxCode(code, lang, theme)) : highlightCode(source, language))
    : language ? source.split('\n').map(line => theme.fg('text', line)) : plainTextLines(source, theme);
  const innerWidth = width - 2;
  const blank = paintCodeLine(' '.repeat(width), theme);
  const body = lines.flatMap(line => wrapTextWithAnsi(line, innerWidth).map(part =>
    paintCodeLine(' ' + part + ' '.repeat(Math.max(0, innerWidth - visibleWidth(part))) + ' ', theme)));
  return [blank, ...body, blank];
}

export function markdownCodeCards(markdown: string, context: MarkdownTransformContext, theme: Theme) {
  if (context.availableWidth < 6) return markdown;
  const lines = markdown.split('\n');
  const result: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const opener = /^( {0,3})(`{3,}|~{3,})([^`~]*)$/.exec(lines[index]);
    if (!opener) { result.push(lines[index]); continue; }
    const [, indent, fence, info] = opener;
    const closing = new RegExp('^ {0,3}' + fence[0] + '{' + fence.length + ',}\\s*$');
    let end = index + 1;
    while (end < lines.length && !closing.test(lines[end])) end++;
    if (indent) {
      result.push(...lines.slice(index, end < lines.length ? end + 1 : end));
      index = end;
      continue;
    }
    const source = lines.slice(index + 1, end).map(line => line.startsWith(indent) ? line.slice(indent.length) : line).join('\n');
    // The visible info suffix keeps native Markdown from highlighting these already-styled display lines twice.
    result.push(indent + fence + (info.trim() || 'text') + ' · code');
    result.push(...cardLines(source, info, context.availableWidth - 2, context.isStreaming, theme).map(line => indent + line));
    if (end < lines.length) result.push(lines[end]);
    index = end;
  }
  return result.join('\n');
}
