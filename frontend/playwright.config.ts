import { defineConfig, devices } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const configDirectory = dirname(fileURLToPath(import.meta.url))
const envFile = readFileSync(resolve(configDirectory, '..', '.env'), 'utf8')
const localSettings = Object.fromEntries(
  envFile.split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=')
      return [line.slice(0, separator), line.slice(separator + 1)]
    }),
)

process.env.E2E_USERNAME = localSettings.APP_BOOTSTRAP_ADMIN_USERNAME
process.env.E2E_PASSWORD = localSettings.APP_BOOTSTRAP_ADMIN_PASSWORD

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8088',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 960 } },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'], channel: 'chrome', viewport: { width: 390, height: 844 } },
    },
  ],
})
