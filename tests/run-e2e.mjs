#!/usr/bin/env node
/**
 * LocalFlow E2E Test Suite Runner
 * Executes all tests using Node 24 native test runner and TypeScript type stripping.
 * Can be run via: node tests/run-e2e.mjs [filter]
 */

import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const e2eDir = resolve(__dirname, 'e2e');

function findTestFiles(dir, filter = '') {
  let results = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(findTestFiles(fullPath, filter));
    } else if (entry.endsWith('.test.ts')) {
      if (!filter || fullPath.includes(filter)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

const filterArg = process.argv[2] || '';
const testFiles = findTestFiles(e2eDir, filterArg);

if (testFiles.length === 0) {
  console.log(`No test files found matching filter "${filterArg}"`);
  process.exit(0);
}

console.log(`\n======================================================`);
console.log(`LocalFlow E2E Test Suite - Launching ${testFiles.length} test files`);
console.log(`======================================================\n`);

const nodeArgs = [
  '--experimental-strip-types',
  '--test',
  ...testFiles
];

const child = spawn(process.execPath, nodeArgs, {
  stdio: 'inherit',
  cwd: resolve(__dirname, '..')
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
