import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@core': resolve('src/core'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'extraction-worker': resolve('src/main/extraction/extraction-worker.ts')
        }
      }
    }
  },
  preload: {
    // zod must be bundled: sandboxed preloads cannot require() external modules
    plugins: [externalizeDepsPlugin({ exclude: ['zod'] })],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts')
        },
        output: {
          // sandboxed preload scripts must be CommonJS
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@core': resolve('src/core'),
        '@shared': resolve('src/shared')
      }
    }
  }
})
