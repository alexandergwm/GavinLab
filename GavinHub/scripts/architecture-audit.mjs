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

for (const name of jsFiles) {
  const file = join(jsRoot, name);
  const source = read(file);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    errors.push(`${name}: ${error.stderr?.toString().trim() || 'syntax error'}`);
  }

  const dependencies = [];
  for (const match of source.matchAll(/(?:from\s+|import\s*\()\s*['"](\.\/[^'"]+\.js)['"]/g)) {
    const dependency = resolve(jsRoot, match[1]);
    if (!existsSync(dependency)) errors.push(`${name}: missing import ${match[1]}`);
  }
  for (const match of source.matchAll(/^import[\s\S]*?from\s+['"](\.\/[^'"]+\.js)['"];?/gm)) {
    dependencies.push(basename(match[1]));
  }
  graph.set(name, dependencies);

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
const ids = [...html.matchAll(/\sid=["']([^"']+)["']/g)].map((match) => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicateIds.length) errors.push(`duplicate DOM ids: ${duplicateIds.join(', ')}`);

let blockingCssBytes = 0;
for (const match of html.matchAll(/<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+\.css)["'][^>]*>/g)) {
  const file = join(root, match[1]);
  if (existsSync(file)) blockingCssBytes += statSync(file).size;
}
if (blockingCssBytes > 70_000) {
  errors.push(`render-blocking CSS is ${blockingCssBytes} bytes (budget 70000)`);
}

if (errors.length) {
  console.error(`ARCHITECTURE AUDIT FAILED:\n${errors.map((error) => `  - ${error}`).join('\n')}`);
  process.exit(1);
}

console.log(
  `ARCHITECTURE AUDIT OK: ${jsFiles.length} modules, ${ids.length} DOM ids, ${blockingCssBytes} render-blocking CSS bytes`,
);
