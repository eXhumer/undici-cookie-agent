import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm', 'cjs'],
  sourcemap: true,
  dts: {
    sourcemap: true,
  },
})
