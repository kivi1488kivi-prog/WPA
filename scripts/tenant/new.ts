/**
 * npm run tenant:new -- <slug> [--from=<existing-slug>]
 * Scaffolds tenants/<slug>/ from tenants/_template (or another tenant).
 * No source code is copied or changed: only configuration + images.
 */
import { existsSync } from 'node:fs';
import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { args } from './env.ts';
import { TENANTS_DIR } from './lib.ts';

const { values, positional } = args();
const slug = positional[0];
if (!slug || !/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) {
  console.error('usage: npm run tenant:new -- <slug> [--from=<template-or-slug>]  (slug: a-z, 0-9, dashes; 3–40 chars)');
  process.exit(2);
}
const target = path.join(TENANTS_DIR, slug);
if (existsSync(target)) {
  console.error(`✗ tenants/${slug} already exists — existing tenants are never overwritten`);
  process.exit(1);
}
const from = path.join(TENANTS_DIR, values.from ?? '_template');
if (!existsSync(path.join(from, 'business.json'))) {
  console.error(`✗ template not found: ${from}`);
  process.exit(1);
}
await cp(from, target, { recursive: true });
const file = path.join(target, 'business.json');
const json = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
json.slug = slug;
delete json.demo;
json.is_demo = false;
json.credits = [];
await writeFile(file, JSON.stringify(json, null, 2) + '\n');
console.log(`✓ created tenants/${slug}/business.json`);
console.log('Next steps:');
console.log(`  1. edit tenants/${slug}/business.json and replace images in tenants/${slug}/images/`);
console.log(`  2. npm run tenant:validate -- ${slug}`);
console.log(`  3. npm run tenant:publish -- ${slug}`);
console.log(`  4. npm run tenant:member -- ${slug} owner@example.com owner`);
console.log(`  5. npm run build && deploy, then npm run tenant:verify -- ${slug}`);
