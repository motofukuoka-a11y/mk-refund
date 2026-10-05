import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('.',import.meta.url)));
await build({entryPoints:['worker-source.js'],outfile:'../vendor/paddle-v4/worker.js',bundle:true,minify:true,format:'esm',platform:'browser',target:['es2022'],alias:{'onnxruntime-web':'onnxruntime-web/wasm'},external:['fs','path'],legalComments:'linked'});

import {cp,mkdir,writeFile} from 'node:fs/promises';
await mkdir('../vendor/heic-v1',{recursive:true});
await cp('node_modules/heic-to/dist/csp/heic-to.js','../vendor/heic-v1/heic-to.js');
await cp('node_modules/heic-to/LICENSE','../vendor/heic-v1/LICENSE');
await cp('node_modules/heic-to/esbuild.mjs','../vendor/heic-v1/esbuild.mjs');
await cp('node_modules/heic-to/src','../vendor/heic-v1/src',{recursive:true});
await cp('node_modules/heic-to/package.json','../vendor/heic-v1/package.json');
await cp('node_modules/heic-to/README.md','../vendor/heic-v1/UPSTREAM-README.md');
