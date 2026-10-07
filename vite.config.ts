import { build, defineConfig, type BuildEnvironmentOptions, type Plugin } from 'vite';

const libBuild: BuildEnvironmentOptions = {
  lib: {
    entry: 'src/index.ts',
    formats: ['es'],
    fileName: () => 'qr-tree.js',
  },
  target: 'es2022',
};

/** Builds the self-contained <qr-tree> bundle in memory and returns its code. */
async function buildLib(root: string): Promise<string> {
  const out = await build({ root, configFile: false, logLevel: 'silent', build: { ...libBuild, write: false } });
  const { output } = (Array.isArray(out) ? out[0] : out) as { output: { code?: string }[] };
  return output[0].code!;
}

// The demo's "Download HTML" button inlines /dist/qr-tree.js, so that path must always hold a
// current bundle: in dev it's built on request (never a stale `npm run build`), and the site build
// (`npm run build:site`, for static hosting) emits it next to index.html.
// ponytail: dev rebuilds on every request (~0.5s), fine for a button click; cache by mtime if it ever matters.
const freshBundle = (): Plugin => {
  let root = process.cwd();
  return {
    name: 'fresh-bundle',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use('/dist/qr-tree.js', async (_req, res, next) => {
        try {
          const code = await buildLib(root);
          res.setHeader('Content-Type', 'application/javascript');
          res.setHeader('Cache-Control', 'no-store');
          res.end(code);
        } catch (e) {
          next(e);
        }
      });
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'dist/qr-tree.js', source: await buildLib(root) });
    },
  };
};

// `npm run dev`        serves the demo (index.html).
// `npm run build`      produces a single self-contained ES module: dist/qr-tree.js
// `npm run build:site` produces the static demo site in site/ (e.g. for Cloudflare Pages)
export default defineConfig(({ command, mode }) => ({
  plugins: command === 'serve' || mode === 'site' ? [freshBundle()] : [],
  build: mode === 'site' ? { outDir: 'site', emptyOutDir: true, target: 'es2022' } : libBuild,
}));
