import { createReadStream, cpSync, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { defineConfig, type Connect, type Plugin } from 'vite';

// The app reads data that lives outside web/: the terrain and map data written by
// tools/export_pilot.py (pilot/data/<area>/) and the tree and boat models
// in blender/out/. In development they are served from where they are; a build copies them
// into dist/ under the same URLs.
const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '..');
const MOUNTS: Record<string, string> = {
  '/data/': resolve(ROOT, 'pilot/data'),
  '/models/trees/': resolve(ROOT, 'blender/out/trees/models'),
  '/models/sailboat/': resolve(ROOT, 'blender/out/sailboat/models')
};
const TYPES: Record<string, string> = {
  '.json': 'application/json', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary'
};

function projectData(): Plugin {
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    const url = decodeURIComponent((req.url || '').split('?')[0]);
    for (const [prefix, dir] of Object.entries(MOUNTS)) {
      if (!url.startsWith(prefix)) continue;
      const file = resolve(dir, url.slice(prefix.length));
      if (!file.startsWith(dir + sep) || !existsSync(file) || !statSync(file).isFile()) break;
      res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
      res.setHeader('Content-Length', statSync(file).size);
      createReadStream(file).pipe(res);
      return;
    }
    next();
  };
  return {
    name: 'project-data',
    configureServer(server) { server.middlewares.use(serve); },
    configurePreviewServer(server) { server.middlewares.use(serve); },
    closeBundle() {
      const out = resolve(HERE, 'dist');
      if (!existsSync(out)) return;
      for (const [prefix, dir] of Object.entries(MOUNTS)) if (existsSync(dir)) cpSync(dir, resolve(out, prefix.slice(1)), { recursive: true });
    }
  };
}

export default defineConfig({
  plugins: [projectData()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 }
});
