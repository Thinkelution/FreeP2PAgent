const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({ testDir: './test/e2e', timeout: 90000, workers: 1, reporter: 'list', use: { trace: 'retain-on-failure' } });
