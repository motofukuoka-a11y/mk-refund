import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('.',import.meta.url)));
await build({entryPoints:['worker-source.js'],outfile:'../vendor/paddle-v4/worker.js',bundle:true,minify:true,format:'esm',platform:'browser',target:['es2022'],alias:{'onnxruntime-web':'onnxruntime-web/wasm'},external:['fs','path'],legalComments:'linked'});
