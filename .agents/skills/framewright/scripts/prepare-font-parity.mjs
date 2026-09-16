#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve(process.argv[2] || 'examples/book-ad-v0/index.html');
const dst = path.resolve(process.argv[3] || 'examples/book-ad-v0/index-e07.html');
let html = fs.readFileSync(src, 'utf8');
html = html.replaceAll('Arial, "DejaVu Sans", sans-serif', '"DejaVu Sans"');
html = html.replaceAll('Arial,sans-serif', '"DejaVu Sans"');
if (html === fs.readFileSync(src, 'utf8')) throw new Error('Expected font stack not found');
fs.writeFileSync(dst, html);
console.log(`prepared ${dst}`);
