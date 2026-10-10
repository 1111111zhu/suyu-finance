import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
await build({absWorkingDir:root,entryPoints:['salary-editor/editor.js','salary-editor/formula-worker.js'],outdir:'public/salary/editor-assets',bundle:true,minify:true,format:'esm',target:['chrome110','safari16'],define:{'process.env.NODE_ENV':'"production"'},loader:{'.woff':'file','.woff2':'file','.ttf':'file','.svg':'dataurl'},legalComments:'linked',logLevel:'info'});
