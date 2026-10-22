const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createCoordinator } = require('../../coordinator/server.cjs');
test('two desktop agents pair, chat, transfer a real file, reject a transfer, and persist contacts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freep2p-e2e-'));
  const receiveDir = path.join(root, 'received'); fs.mkdirSync(receiveDir);
  const source = path.join(root, 'payload.bin'); const bytes = crypto.randomBytes(2 * 1024 * 1024 + 13); fs.writeFileSync(source, bytes);
  const coordinator = createCoordinator({ iceServers: [] }); const addr = await coordinator.listen();
  const url = process.env.FP_E2E_COORDINATOR || `ws://127.0.0.1:${addr.port}/ws`; const apps = [];
  const route = process.env.FP_E2E_RELAY ? 'Relayed' : 'Direct';
  if (process.env.FP_E2E_COORDINATOR) test.setTimeout(180000);
  async function launch(name) {
    const env = { ...process.env, FP_TEST: '1', FP_PROFILE: path.join(root, name), FP_COORDINATOR: url, FP_SEND_FILE: source, FP_RECEIVE_DIR: receiveDir };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await electron.launch({ args: [path.resolve(__dirname, '../..')], env });
    apps.push(app); const page = await app.firstWindow();
    if (process.env.FP_E2E_RELAY) {
      await page.evaluate(() => {
        const Native = window.RTCPeerConnection;
        window.RTCPeerConnection = class extends Native { constructor(config) { super({ ...config, iceTransportPolicy: 'relay' }); } };
      });
    }
    page.on('pageerror', error => console.error(name, error.message));
    page.on('console', message => { if (message.type() === 'error') console.error(name, message.text()); });
    await expect(page.locator('#coordinatorStatus')).toHaveText('● Coordinator connected');
    return { app, page };
  }
  try {
    const a = await launch('Alice'), b = await launch('Bob');
    for (const [instance, name] of [[a, 'Alice'], [b, 'Bob']]) {
      await instance.page.getByRole('button', { name: 'Settings', exact: true }).click(); await instance.page.locator('#nameInput').fill(name);
      await instance.page.getByRole('button', { name: 'Save & reconnect' }).click();
      await expect(instance.page.locator('#coordinatorStatus')).toHaveText('● Coordinator connected');
    }
    const invitation = await b.page.evaluate(() => window.peer.snapshot().then(s => s.invite));
    await a.page.locator('#addButton').click(); await a.page.locator('#inviteInput').fill(invitation); await a.page.getByRole('button', { name: 'Send request', exact: true }).click();
    await b.page.locator('.friend').click(); await b.page.getByRole('button', { name: 'Accept friend', exact: true }).click();
    await expect(a.page.locator('#connectionStatus')).toContainText(route, { timeout: 40000 }).catch(async e => {
      console.log('Notices', await a.page.locator('#toast').textContent(), await b.page.locator('#toast').textContent());
      throw e;
    });
    await expect(b.page.locator('#connectionStatus')).toContainText(route, { timeout: 40000 });
    await a.page.locator('#messageInput').fill('Hello Bob <script>not executable</script>'); await a.page.locator('#sendMessage').click();
    await expect(b.page.locator('.bubble')).toHaveText('Hello Bob <script>not executable</script>');
    await expect(a.page.locator('.message small')).toContainText('Delivered');
    await b.page.locator('#messageInput').fill('Hello Alice'); await b.page.locator('#sendMessage').click();
    await expect(a.page.locator('.bubble').last()).toHaveText('Hello Alice');
    await a.page.locator('#sendFile').click(); await b.page.getByRole('button', { name: 'Accept file', exact: true }).click();
    await expect(a.page.locator('.transfer')).toContainText('Complete · verified', { timeout: 60000 });
    expect(fs.readFileSync(path.join(receiveDir, 'payload.bin')).equals(bytes)).toBe(true);
    await a.page.locator('#sendFile').click(); await b.page.getByRole('button', { name: 'Cancel transfer', exact: true }).click();
    await expect(a.page.locator('.transfer').last()).toContainText('Cancelled by friend');
    await a.page.screenshot({ path: 'test-results/desktop-alice.png' });
    await b.app.close(); apps.splice(apps.indexOf(b.app), 1);
    const restarted = await launch('Bob'); await restarted.page.locator('.friend').click();
    await expect(restarted.page.locator('.bubble').first()).toContainText('Hello Bob');
    await expect(restarted.page.locator('#connectionStatus')).toContainText(route, { timeout: 40000 });
    await restarted.page.locator('#removeFriend').click(); await restarted.page.locator('#confirmRemove').click();
    await expect(restarted.page.locator('.friend')).toHaveCount(0);
    await expect(a.page.locator('#sendMessage')).toBeDisabled();
  } finally {
    for (const app of apps) await app.close(); await coordinator.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
