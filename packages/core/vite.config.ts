import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'archiyou-core',
      fileName: (format) => `archiyou-core.${format}.js`,
    },
    rollupOptions: {
      external: [],
    },
  },
})
