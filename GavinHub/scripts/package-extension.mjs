#!/usr/bin/env node
/**
 * 打包 Edge 扩展：输出 dist/gavinhub-edge/ 与 dist/gavinhub-edge.zip
 * 仅包含运行时文件，排除 node_modules、测试与开发脚本。
 */
import { createHash } from 'crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { spawnSync } from 'child_process';

const root = new URL('..', import.meta.url).pathname;
const distDir = join(root, 'dist', 'gavinhub-edge');
const zipPath = join(root, 'dist', 'gavinhub-edge.zip');

const INCLUDE = [
  'manifest.json',
  'index.html',
  'newtab.html',
  'EXTENSION.md',
  'css/base.css',
  'css/home.css',
  'css/apps.css',
  'css/dialogs.css',
  'assets/default-wallpaper.jpg',
];

function copyIcons(outRoot) {
  const iconsDir = join(outRoot, 'icons');
  mkdirSync(iconsDir, { recursive: true });
  // 始终从项目 icons/ 复制（由 generate-icons.mjs 生成）
  spawnSync(process.execPath, [join(root, 'scripts', 'generate-icons.mjs')], { stdio: 'pipe' });
  for (const size of [16, 32, 48, 96, 128]) {
    const rel = `icons/icon-${size}.png`;
    const src = join(root, rel);
    const dest = join(outRoot, rel);
    if (!existsSync(src)) {
      throw new Error(`missing icon: ${rel} — run node scripts/generate-icons.mjs`);
    }
    cpSync(src, dest);
  }
}

function collectJsFiles() {
  const dormantModules = new Set(['feed.js', 'arxiv.js', 'github-home.js']);
  return readdirSync(join(root, 'js'))
    .filter((f) => f.endsWith('.js') && !dormantModules.has(f))
    .map((f) => `js/${f}`);
}

function copyFile(srcRel, destRoot) {
  const src = join(root, srcRel);
  const dest = join(destRoot, srcRel);
  mkdirSync(join(dest, '..'), { recursive: true });
  cpSync(src, dest);
}

function buildManifest() {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  manifest.icons = {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    96: 'icons/icon-96.png',
    128: 'icons/icon-128.png',
  };
  return manifest;
}

function verifyPackage(outRoot) {
  const manifest = JSON.parse(readFileSync(join(outRoot, 'manifest.json'), 'utf8'));
  if (!manifest.chrome_url_overrides?.newtab) {
    throw new Error('manifest missing chrome_url_overrides.newtab');
  }
  if (!existsSync(join(outRoot, manifest.chrome_url_overrides.newtab))) {
    throw new Error(`missing newtab file: ${manifest.chrome_url_overrides.newtab}`);
  }
  if (!existsSync(join(outRoot, 'index.html'))) {
    throw new Error('missing index.html');
  }
  if (!manifest.background?.service_worker) {
    throw new Error('manifest missing background.service_worker (needed for search focus)');
  }
  if (!existsSync(join(outRoot, manifest.background.service_worker))) {
    throw new Error(`missing service worker: ${manifest.background.service_worker}`);
  }
  if (manifest.chrome_url_overrides.newtab !== 'newtab.html') {
    throw new Error('newtab override must be newtab.html so background.js can swap to a focusable page');
  }
  const backgroundSource = readFileSync(join(outRoot, manifest.background.service_worker), 'utf8');
  if (!backgroundSource.includes('swapNtpToFocusablePage')) {
    throw new Error('background.js must swap NTP tabs for search focus');
  }
  const jsCount = readdirSync(join(outRoot, 'js')).filter((f) => f.endsWith('.js')).length;
  if (jsCount < 31) throw new Error(`expected >=31 js modules, got ${jsCount}`);
  for (const file of readdirSync(join(outRoot, 'js')).filter((f) => f.endsWith('.js'))) {
    const source = readFileSync(join(outRoot, 'js', file), 'utf8');
    const imports = source.matchAll(/(?:from\s+|import\s*\()\s*['"](\.\/[^'"]+\.js)['"]/g);
    for (const match of imports) {
      const dependency = join(outRoot, 'js', match[1]);
      if (!existsSync(dependency)) {
        throw new Error(`missing packaged dependency: js/${file} -> ${match[1]}`);
      }
    }
  }
  for (const dormant of ['js/feed.js', 'js/arxiv.js', 'js/github-home.js', 'css/feed.css']) {
    if (existsSync(join(outRoot, dormant))) throw new Error(`dormant file should not be packaged: ${dormant}`);
  }
}

function zipDirectory(sourceDir, zipFile) {
  const result = spawnSync('zip', ['-r', zipFile, '.'], {
    cwd: sourceDir,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error('zip command failed — ensure zip is available on PATH');
  }
}

function main() {
  console.log('Packaging Edge extension…');

  const selfCheck = spawnSync('node', ['scripts/self-check.mjs'], { cwd: root, stdio: 'inherit' });
  if (selfCheck.status !== 0) process.exit(selfCheck.status);

  rmSync(join(root, 'dist'), { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  const files = [...INCLUDE, ...collectJsFiles()];
  for (const rel of files) {
    if (!existsSync(join(root, rel))) {
      console.error(`Missing required file: ${rel}`);
      process.exit(1);
    }
    copyFile(rel, distDir);
  }

  copyIcons(distDir);
  writeFileSync(join(distDir, 'manifest.json'), `${JSON.stringify(buildManifest(), null, 2)}\n`);

  verifyPackage(distDir);
  zipDirectory(distDir, zipPath);

  const bytes = statSync(zipPath).size;
  const hash = createHash('sha256').update(readFileSync(zipPath)).digest('hex').slice(0, 12);
  console.log('');
  console.log('Edge extension packaged successfully.');
  console.log(`  Folder: ${relative(root, distDir)}/`);
  console.log(`  Zip:    ${relative(root, zipPath)} (${(bytes / 1024).toFixed(1)} KB, sha256:${hash}…)`);
  console.log('');
  console.log('Install in Edge:');
  console.log('  1. edge://extensions → 开发人员模式 → 加载解压缩的扩展');
  console.log(`  2. Select: ${distDir}`);
  console.log('  Or unzip gavinhub-edge.zip and load that folder.');
}

main();
