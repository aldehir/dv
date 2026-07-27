import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { defineConfig, type Plugin } from 'vitest/config';

const DEV_API_TARGET = 'http://localhost:8765';
const COMPRESSIBLE = /\.(js|css|html|svg|json|map)$/;
const MIN_COMPRESS_BYTES = 1024;
const EMBED_KEEPFILE = '.gitkeep';

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

const distAssets = (): Plugin => {
  let outDir = '';
  return {
    name: 'dv-dist-assets',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      writeFileSync(join(outDir, EMBED_KEEPFILE), '');
      for (const file of walk(outDir)) {
        if (!COMPRESSIBLE.test(file)) continue;
        const source = readFileSync(file);
        if (source.byteLength < MIN_COMPRESS_BYTES) continue;
        writeFileSync(`${file}.gz`, gzipSync(source, { level: 9 }));
        writeFileSync(
          `${file}.br`,
          brotliCompressSync(source, {
            params: {
              [constants.BROTLI_PARAM_QUALITY]: 11,
              [constants.BROTLI_PARAM_SIZE_HINT]: source.byteLength,
            },
          }),
        );
      }
    },
  };
};

const chunkFor = (id: string): string | undefined => {
  if (!id.includes('node_modules')) return undefined;
  if (/(shiki|@shikijs)[\\/](dist[\\/])?(langs|themes)/.test(id)) return undefined;
  if (id.includes('@pierre/diffs')) return 'diffs';
  if (id.includes('shiki') || id.includes('@shikijs')) return 'shiki';
  return undefined;
};

export default defineConfig({
  base: '/',
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    target: 'es2022',
    sourcemap: false,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks: chunkFor,
      },
    },
  },
  server: {
    proxy: {
      '/api': { target: DEV_API_TARGET, changeOrigin: true },
    },
  },
  plugins: [distAssets()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
    restoreMocks: true,
  },
});
