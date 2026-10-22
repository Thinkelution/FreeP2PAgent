const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, clipboard, dialog, safeStorage, Notification, session } = require('electron');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { Agent } = require('./agent.cjs');
const { FileVault } = require('./files.cjs');

const testing = !app.isPackaged && process.env.FP_TEST === '1';
if (testing && process.env.FP_PROFILE) app.setPath('userData', process.env.FP_PROFILE);
let window, tray, agent, quitting = false;
const files = new FileVault();
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    let storage = safeStorage;
    if (testing) storage = { encryptString: s => Buffer.from(s), decryptString: b => b.toString() };
    else if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
      dialog.showErrorBox('Secure storage unavailable', 'FreeP2PAgent needs your OS keychain to protect your identity. On Linux, unlock a Secret Service keyring (GNOME Keyring or KWallet), then restart.');
      return app.quit();
    }
    agent = new Agent(app.getPath('userData'), storage, { url: process.env.FP_COORDINATOR });
    // The bundled UI needs LAN/loopback for WebRTC. Never grant media/location.
    const networkPermissions = new Set(['local-network', 'loopback-network', 'local-network-access']);
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(wc === window?.webContents && networkPermissions.has(permission)));
    session.defaultSession.setPermissionCheckHandler((wc, permission) => wc === window?.webContents && networkPermissions.has(permission));
    window = new BrowserWindow({ width: 1160, height: 780, minWidth: 900, minHeight: 620, show: !testing,
      backgroundColor: '#10141b', title: 'FreeP2PAgent', icon: path.join(__dirname, '../assets/icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.on('close', e => { if (!quitting) { e.preventDefault(); window.hide(); } });
    window.webContents.on('render-process-gone', () => { files.close(); app.quit(); });
    function publish(channel, value) { if (!window.isDestroyed()) window.webContents.send(channel, value); }
    agent.on('state', state => { publish('state', state); updateTray(); });
    agent.on('signal', value => publish('signal', value));
    agent.on('disconnect-peer', id => publish('disconnect-peer', id));
    agent.on('notice', text => notify(text));
    function handle(name, fn) {
      ipcMain.handle(name, async (event, ...args) => {
        if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || fileURLToPath(event.senderFrame.url) !== path.join(__dirname, 'renderer/index.html')) throw new Error('Untrusted IPC sender');
        return fn(...args);
      });
    }
    handle('snapshot', () => agent.snapshot());
    handle('settings', value => agent.settings(value));
    handle('invite-copy', () => clipboard.writeText(agent.snapshot().invite));
    handle('friend-add', value => agent.add(value));
    handle('friend-accept', id => agent.accept(id));
    handle('friend-remove', id => agent.remove(id));
    handle('signal-send', ({ id, data }) => agent.signal(id, data));
    handle('chat-save', ({ id, entry }) => agent.message(id, entry));
    handle('chat-ack', ({ id, messageId }) => agent.delivered(id, messageId));
    handle('notify', text => { if (typeof text === 'string' && text.length < 150) notify(text); });
    handle('file-pick', async () => {
      const result = testing && process.env.FP_SEND_FILE ? { filePaths: [process.env.FP_SEND_FILE] } : await dialog.showOpenDialog(window, { title: 'Send a file to your friend', properties: ['openFile'] });
      if (result.canceled || !result.filePaths.length) return null;
      return files.offer(result.filePaths[0]);
    });
    handle('file-read', id => files.read(id));
    handle('file-receive', async ({ name, size }) => {
      if (typeof name !== 'string' || name.length > 255) throw new Error('Invalid filename');
      const safeName = path.basename(name.replaceAll('\\', '/')).replace(/[<>:"|?*\x00-\x1f]/g, '_') || 'download';
      const result = testing && process.env.FP_RECEIVE_DIR ? { filePath: path.join(process.env.FP_RECEIVE_DIR, safeName) } : await dialog.showSaveDialog(window, { title: 'Save incoming file', defaultPath: path.join(app.getPath('downloads'), safeName) });
      if (result.canceled || !result.filePath) return null;
      return files.receive(result.filePath, size);
    });
    handle('file-write', ({ id, data }) => files.write(id, data));
    handle('file-finish', ({ id, sha256 }) => files.finish(id, sha256));
    handle('file-cancel', id => files.cancel(id));
    handle('reconnect', () => { agent.start(); agent.update(); });
    if (!testing) {
      const icon = nativeImage.createFromPath(path.join(__dirname, '../assets/tray.png')).resize({ width: 20, height: 20 });
      if (process.platform === 'darwin') icon.setTemplateImage(true);
      tray = new Tray(icon); tray.setToolTip('FreeP2PAgent');
      tray.on('click', () => { window.show(); window.focus(); }); updateTray();
    }
    await window.loadFile(path.join(__dirname, 'renderer/index.html'));
    agent.start();
  }).catch(error => { dialog.showErrorBox('FreeP2PAgent could not start', error.message); app.quit(); });
}
function notify(body) {
  if (!testing && !window?.isFocused() && Notification.isSupported()) {
    const n = new Notification({ title: 'FreeP2PAgent', body }); n.on('click', () => window?.show()); n.show();
  }
}
function updateTray() {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: agent?.online ? 'Coordinator connected' : 'Coordinator disconnected', enabled: false },
    { label: 'Open FreeP2PAgent', click: () => { window.show(); window.focus(); } },
    { label: 'Copy my invite', click: () => clipboard.writeText(agent.snapshot().invite) },
    { type: 'separator' }, { label: 'Quit', click: () => app.quit() }
  ]));
}
app.on('activate', () => window?.show());
app.on('window-all-closed', () => {});
app.on('before-quit', () => { quitting = true; agent?.stop(); files.close(); });
