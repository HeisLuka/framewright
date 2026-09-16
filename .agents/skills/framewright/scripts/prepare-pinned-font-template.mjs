#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve(process.argv[2] || 'examples/book-ad-v0/index.html');
const dst = path.resolve(process.argv[3] || 'examples/book-ad-v0/index-e08.html');
const original = fs.readFileSync(src, 'utf8');
let html = original.replaceAll('Arial, "DejaVu Sans", sans-serif', '"DejaVu Sans"');
html = html.replaceAll('Arial,sans-serif', '"DejaVu Sans"');

// E08 stress fixtures exposed a real layout bug in Book Ad v0: wrapAll() only
// breaks at spaces, while fitBlock() previously accepted a line even when one
// unbreakable token was wider than maxW. Make width part of the fit contract.
const oldFit = `    if(lines.length<=maxLines&&lines.length*lh<=maxH){overflow=false;break;}`;
const newFit = `    const widthOK=lines.every(line=>g.measureText(line).width<=maxW);\n    if(widthOK&&lines.length<=maxLines&&lines.length*lh<=maxH){overflow=false;break;}`;
if (!html.includes(oldFit)) throw new Error('Expected fitBlock success condition not found');
html = html.replace(oldFit, newFit);

const oldTail = `  if(lines.length>allowed){lines=lines.slice(0,allowed);lines[allowed-1]=ellipsizeLine(g,lines[allowed-1],maxW);overflow=true;}\n  return{size,lines,lh,height:lines.length*lh,overflow};`;
const newTail = `  if(lines.length>allowed){lines=lines.slice(0,allowed);lines[allowed-1]=ellipsizeLine(g,lines[allowed-1],maxW);overflow=true;}\n  if(lines.some(line=>g.measureText(line).width>maxW)){lines=lines.map(line=>g.measureText(line).width<=maxW?line:ellipsizeLine(g,line,maxW));overflow=true;}\n  return{size,lines,lh,height:lines.length*lh,overflow};`;
if (!html.includes(oldTail)) throw new Error('Expected fitBlock tail not found');
html = html.replace(oldTail, newTail);

if (html === original) throw new Error('Template transform made no changes');
fs.writeFileSync(dst, html);
console.log(`prepared pinned-font width-safe template ${dst}`);
