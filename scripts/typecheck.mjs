import ts from 'typescript';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { loadPiSdk } from './pi-sdk.mjs';

const { entry } = await loadPiSdk();
const require = createRequire(entry);
const tuiTypes = require.resolve('@earendil-works/pi-tui').replace(/\.js$/, '.d.ts');
const options = {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true,
  noEmit: true, allowImportingTsExtensions: true, allowJs: true, checkJs: false,
  skipLibCheck: true, types: ['node'], typeRoots: [resolve('node_modules/@types')],
  paths: {
    '@earendil-works/pi-coding-agent': [resolve(dirname(entry), '../index.d.ts')],
    '@earendil-works/pi-tui': [tuiTypes],
  },
};
const program = ts.createProgram(['index.ts', 'code-cards.ts', 'markdown.ts'].map(path => resolve(path)), options);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => process.cwd(), getCanonicalFileName: path => path, getNewLine: () => '\n',
  }));
  process.exitCode = 1;
} else console.log('PASS strict TypeScript check against the installed Pi host API.');
