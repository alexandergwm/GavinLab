#!/usr/bin/env node
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { basename, join, resolve } from 'path';

const root = new URL('..', import.meta.url).pathname;
const jsRoot = join(root, 'js');
const errors = [];

const read = (path) => readFileSync(path, 'utf8');
const jsFiles = readdirSync(jsRoot).filter((name) => name.endsWith('.js'));
const graph = new Map();
const runtimeGraph = new Map();

for (const name of jsFiles) {
  const file = join(jsRoot, name);
  const source = read(file);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    errors.push(`${name}: ${error.stderr?.toString().trim() || 'syntax error'}`);
  }

  const runtimeDependencies = new Set();
  for (const match of source.matchAll(/(?:from\s+|import\s*\()\s*['"](\.\/[^'"]+\.js)['"]/g)) {
    const dependency = resolve(jsRoot, match[1]);
    if (!existsSync(dependency)) errors.push(`${name}: missing import ${match[1]}`);
    runtimeDependencies.add(basename(match[1]));
  }
  const staticDependencies = new Set();
  for (const match of source.matchAll(/^import[\s\S]*?from\s+['"](\.\/[^'"]+\.js)['"];?/gm)) {
    staticDependencies.add(basename(match[1]));
  }
  graph.set(name, [...staticDependencies]);
  runtimeGraph.set(name, [...runtimeDependencies]);

  if (name !== 'dialog-ui.js' && /\.showModal\s*\(/.test(source)) {
    errors.push(`${name}: bypasses dialog-ui open lifecycle`);
  }
  if (statSync(file).size > 55_000) {
    errors.push(`${name}: exceeds the 55 KB module budget`);
  }
}

const visiting = new Set();
const visited = new Set();
function visit(name, path = []) {
  if (visiting.has(name)) {
    errors.push(`static import cycle: ${[...path, name].join(' -> ')}`);
    return;
  }
  if (visited.has(name)) return;
  visiting.add(name);
  for (const dependency of graph.get(name) || []) visit(dependency, [...path, name]);
  visiting.delete(name);
  visited.add(name);
}
for (const name of jsFiles) visit(name);

const html = read(join(root, 'index.html'));
const newtabHtml = read(join(root, 'newtab.html'));
const manifest = JSON.parse(read(join(root, 'manifest.json')));
const entryModules = new Set();
for (const source of [html, newtabHtml]) {
  for (const match of source.matchAll(/<script\s+[^>]*src=["']js\/([^"']+\.js)["'][^>]*>/g)) {
    entryModules.add(match[1]);
  }
}
if (manifest.background?.service_worker?.startsWith('js/')) {
  entryModules.add(basename(manifest.background.service_worker));
}

const reachable = new Set();
function markReachable(name) {
  if (reachable.has(name)) return;
  reachable.add(name);
  for (const dependency of runtimeGraph.get(name) || []) markReachable(dependency);
}
for (const entry of entryModules) {
  if (!graph.has(entry)) errors.push(`missing JavaScript entry module: ${entry}`);
  else markReachable(entry);
}
const unreachable = jsFiles.filter((name) => !reachable.has(name));
if (unreachable.length) errors.push(`modules unreachable from runtime entries: ${unreachable.join(', ')}`);

const ids = [...html.matchAll(/\sid=["']([^"']+)["']/g)].map((match) => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicateIds.length) errors.push(`duplicate DOM ids: ${duplicateIds.join(', ')}`);

const cssRoot = join(root, 'css');
const cssFiles = readdirSync(cssRoot).filter((name) => name.endsWith('.css'));
const referencedCss = new Set(
  [...html.matchAll(/\shref=["']css\/([^"']+\.css)["']/g)].map((match) => match[1]),
);
const unreachableCss = cssFiles.filter((name) => !referencedCss.has(name));
if (unreachableCss.length) errors.push(`stylesheets unreachable from index.html: ${unreachableCss.join(', ')}`);

let blockingCssBytes = 0;
for (const match of html.matchAll(/<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+\.css)["'][^>]*>/g)) {
  const file = join(root, match[1]);
  if (existsSync(file)) blockingCssBytes += statSync(file).size;
}
if (blockingCssBytes > 50_000) {
  errors.push(`render-blocking CSS is ${blockingCssBytes} bytes (budget 50000)`);
}

const lazyCssBudgets = {
  'css/dialogs.css': 5_000,
  'css/settings.css': 7_000,
  'css/weather.css': 9_000,
  'css/todo-dialog.css': 9_000,
  'css/calendar.css': 40_000,
};
for (const [relativePath, budget] of Object.entries(lazyCssBudgets)) {
  const file = join(root, relativePath);
  if (!existsSync(file)) {
    errors.push(`missing lazy stylesheet: ${relativePath}`);
    continue;
  }
  const bytes = statSync(file).size;
  if (bytes > budget) errors.push(`${relativePath} is ${bytes} bytes (budget ${budget})`);
}

if (errors.length) {
  console.error(`ARCHITECTURE AUDIT FAILED:\n${errors.map((error) => `  - ${error}`).join('\n')}`);
  process.exit(1);
}

console.log(
  `ARCHITECTURE AUDIT OK: ${jsFiles.length} modules, ${cssFiles.length} stylesheets, ${ids.length} DOM ids, ${blockingCssBytes} render-blocking CSS bytes`,
);
