import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    AutoImport({ resolvers: [ElementPlusResolver()], dts: 'src/auto-imports.d.ts' }),
    Components({ resolvers: [ElementPlusResolver()], dts: 'src/components.d.ts' }),
  ],
  server: {
    port: 5173,
    proxy: {
      // Docker does not expose the backend's internal :8080 port to macOS.
      // Reuse Caddy on :8088 so Vite HMR and the production build call the same API gateway.
      '/api': { target: 'http://localhost:8088', changeOrigin: true },
      '/actuator': { target: 'http://localhost:8088', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.spec.ts'],
    setupFiles: ['./src/test/setup.ts'],
    server: {
      deps: {
        inline: ['element-plus', '@element-plus/icons-vue'],
      },
    },
  },
})
