#!/usr/bin/env node
/**
 * graphify – baut einen Abhängigkeitsgraphen dieser PWA.
 *
 * Liest die HTML-Einstiegspunkte sowie alle JS-Module und folgt
 *   - <script src="…">            (HTML → Datei)
 *   - import … from '…'           (statischer ES-Import)
 *   - import('…')                 (dynamischer Import)
 *   - importScripts('…')          (Service Worker)
 *
 * Ausgabe: Mermaid (Default), Graphviz-DOT, JSON oder eine
 * eigenständige HTML-Seite mit gerendertem Graphen.
 *
 * Verwendung:
 *   node .claude/skills/graphify/graph.mjs [--format mermaid|dot|json|html]
 *                                          [--out DATEI] [--tests] [--vendor]
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);

const format = opt('format', 'mermaid');
const outFile = opt('out', null);
const withTests = flag('tests');
const withVendor = flag('vendor');

/* ------------------------------------------------------------------ Dateien */

const SKIP_DIRS = new Set(['.git', 'node_modules', '.claude', '.github', 'playwright-report', 'test-results']);

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) walk(abs, acc);
    else acc.push(rel(abs));
  }
  return acc;
}

const rel = (abs) => relative(ROOT, abs).split('\\').join('/');
const files = walk(ROOT);

const isHtml = (f) => f.endsWith('.html');
const isScript = (f) => /\.(m?js)$/.test(f);
const isTest = (f) => f.startsWith('tests/');
const isVendor = (f) => f.startsWith('vendor/');

/* -------------------------------------------------------------------- Kanten */

const edges = [];   // { from, to, kind }
const nodes = new Map();

function addNode(id, kind) {
  if (!nodes.has(id)) nodes.set(id, { id, kind, loc: 0 });
  return nodes.get(id);
}

function kindOf(file) {
  if (isHtml(file)) return 'entry';
  if (/(^|\/)[^/]*\.config\.(m?js)$/.test(file)) return 'config';
  if (isVendor(file)) return 'vendor';
  if (isTest(file)) return 'test';
  if (file === 'sw.js') return 'worker';
  return 'module';
}

// `fromFile` bestimmt das Basisverzeichnis – ausser bei Angaben, die der Browser
// relativ zur Seite aufloest (serviceWorker.register), dort ist es das Wurzelverzeichnis.
function resolveSpec(fromFile, spec, pageRelative = false) {
  if (/^(https?:)?\/\//.test(spec)) return { id: spec, kind: 'external' };
  const clean = spec.split('?')[0].split('#')[0];
  const baseDir = pageRelative ? '.' : posix.dirname(fromFile);
  const base = clean.startsWith('/')
    ? clean.replace(/^\//, '')
    : posix.normalize(posix.join(baseDir, clean));
  const candidates = [base, `${base}.js`, `${base}.mjs`, posix.join(base, 'index.js')];
  for (const c of candidates) {
    if (existsSync(join(ROOT, c))) return { id: c, kind: kindOf(c) };
  }
  // Keine Datei im Projekt: Bare Specifier (node:fs, @playwright/test, …)
  // ist ein Paket, alles mit ./ oder / ein echter toter Link.
  if (!/^[./]/.test(spec)) return { id: spec.replace(/^node:/, ''), kind: 'package' };
  return { id: base, kind: 'missing' };
}

const RE = {
  scriptSrc: /<script[^>]*\ssrc=["']([^"']+)["']/gi,
  staticImport: /(?:^|\n)\s*import\s+(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']/g,
  dynamicImport: /import\s*\(\s*["']([^"']+)["']\s*\)/g,
  importScripts: /importScripts\s*\(\s*["']([^"']+)["']/g,
  swRegister: /serviceWorker\.register\s*\(\s*["']([^"']+)["']/g,
  require: /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
};

for (const file of files) {
  if (!isHtml(file) && !isScript(file)) continue;
  if (!withTests && isTest(file)) continue;
  if (!withVendor && isVendor(file)) continue;

  const src = readFileSync(join(ROOT, file), 'utf8');
  const node = addNode(file, kindOf(file));
  node.loc = src.split('\n').length;

  const collect = (re, kind) => {
    for (const m of src.matchAll(re)) {
      const target = resolveSpec(file, m[1], kind === 'register');
      if (!withVendor && target.kind === 'vendor' && !isHtml(file)) continue;
      addNode(target.id, target.kind);
      edges.push({ from: file, to: target.id, kind });
    }
  };

  if (isHtml(file)) collect(RE.scriptSrc, 'script');
  else {
    collect(RE.staticImport, 'import');
    collect(RE.dynamicImport, 'dynamic');
    collect(RE.importScripts, 'importScripts');
    collect(RE.swRegister, 'register');
    collect(RE.require, 'require');
  }
}

/* ------------------------------------------------------------------ Analysen */

const incoming = new Map([...nodes.keys()].map((id) => [id, 0]));
for (const e of edges) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);

const orphans = [...nodes.values()]
  .filter((n) => (n.kind === 'module' || n.kind === 'worker') && incoming.get(n.id) === 0)
  .map((n) => n.id);

const missing = [...nodes.values()].filter((n) => n.kind === 'missing').map((n) => n.id);

const cycles = [];
{
  const adj = new Map();
  for (const e of edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'open') {
      const at = stack.indexOf(id);
      if (at !== -1) cycles.push([...stack.slice(at), id]);
      return;
    }
    state.set(id, 'open');
    stack.push(id);
    for (const next of adj.get(id) ?? []) visit(next);
    stack.pop();
    state.set(id, 'done');
  };
  for (const id of nodes.keys()) visit(id);
}

/* ------------------------------------------------------------------ Ausgaben */

const LABEL = {
  entry: 'Einstiegspunkt',
  module: 'Modul',
  worker: 'Service Worker',
  vendor: 'Vendor',
  test: 'Test',
  config: 'Konfiguration',
  package: 'Paket / Node-Builtin',
  external: 'Extern (CDN)',
  missing: 'Fehlt!',
};

const safeId = (id) => 'n' + id.replace(/[^A-Za-z0-9]/g, '_');

function toMermaid() {
  const lines = ['flowchart TD'];
  const byKind = new Map();
  for (const n of nodes.values()) byKind.set(n.kind, [...(byKind.get(n.kind) ?? []), n]);

  for (const [kind, list] of byKind) {
    lines.push(`  subgraph ${safeId(kind)}["${LABEL[kind] ?? kind}"]`);
    for (const n of list) {
      const label = n.loc ? `${n.id}<br/><small>${n.loc} Zeilen</small>` : n.id;
      lines.push(`    ${safeId(n.id)}["${label}"]`);
    }
    lines.push('  end');
  }
  for (const e of edges) {
    const arrow = e.kind === 'dynamic' ? '-.->' : '-->';
    lines.push(`  ${safeId(e.from)} ${arrow} ${safeId(e.to)}`);
  }
  lines.push('  classDef missing fill:#fee,stroke:#c00,color:#900;');
  const bad = [...nodes.values()].filter((n) => n.kind === 'missing');
  if (bad.length) lines.push(`  class ${bad.map((n) => safeId(n.id)).join(',')} missing;`);
  return lines.join('\n');
}

function toDot() {
  const lines = ['digraph graphify {', '  rankdir=TB;', '  node [shape=box, fontname="Helvetica"];'];
  for (const n of nodes.values()) {
    lines.push(`  "${n.id}" [label="${n.id}\\n${LABEL[n.kind] ?? n.kind}"];`);
  }
  for (const e of edges) {
    lines.push(`  "${e.from}" -> "${e.to}"${e.kind === 'dynamic' ? ' [style=dashed]' : ''};`);
  }
  lines.push('}');
  return lines.join('\n');
}

function toJson() {
  return JSON.stringify(
    { nodes: [...nodes.values()], edges, orphans, missing, cycles },
    null,
    2
  );
}

function toHtml() {
  const mermaid = toMermaid();
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="de">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Abhaengigkeitsgraph</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#111; --muted:#666; --line:#e2e2e2; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { --bg:#15171a; --fg:#eceff3; --muted:#9aa3ad; --line:#2c3036; }
  }
  :root[data-theme="dark"] { --bg:#15171a; --fg:#eceff3; --muted:#9aa3ad; --line:#2c3036; }
  body { margin:0; padding:24px 16px; background:var(--bg); color:var(--fg);
         font:16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width:1100px; margin:0 auto; }
  h1 { font-size:1.4rem; margin:0 0 4px; }
  p.sub { color:var(--muted); margin:0 0 24px; }
  .card { border:1px solid var(--line); border-radius:12px; padding:16px; margin-bottom:20px; overflow:auto; }
  ul { margin:0; padding-left:20px; }
  code { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
<main>
  <h1>Abhaengigkeitsgraph &middot; TechDoku</h1>
  <p class="sub">${nodes.size} Knoten &middot; ${edges.length} Kanten &middot; erzeugt am ${new Date().toLocaleDateString('de-DE')}</p>
  <div class="card"><pre class="mermaid">${esc(mermaid)}</pre></div>
  <div class="card">
    <h2 style="font-size:1rem;margin:0 0 8px">Befunde</h2>
    <ul>
      <li>Nicht importiert: ${orphans.length ? orphans.map((o) => `<code>${o}</code>`).join(', ') : '&ndash;'}</li>
      <li>Fehlende Ziele: ${missing.length ? missing.map((m) => `<code>${m}</code>`).join(', ') : '&ndash;'}</li>
      <li>Zyklen: ${cycles.length ? cycles.map((c) => `<code>${c.join(' &rarr; ')}</code>`).join('<br>') : '&ndash;'}</li>
    </ul>
  </div>
</main>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: true, theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default' });
</script>
</html>
`;
}

const output =
  format === 'dot' ? toDot() :
  format === 'json' ? toJson() :
  format === 'html' ? toHtml() :
  toMermaid();

if (outFile) {
  writeFileSync(resolve(process.cwd(), outFile), output);
  console.error(`geschrieben: ${outFile}`);
} else {
  console.log(output);
}

if (format !== 'json') {
  console.error(
    `\n# ${nodes.size} Knoten, ${edges.length} Kanten` +
    `\n# nicht importiert: ${orphans.join(', ') || '-'}` +
    `\n# fehlende Ziele:   ${missing.join(', ') || '-'}` +
    `\n# Zyklen:           ${cycles.map((c) => c.join(' -> ')).join(' | ') || '-'}`
  );
}
