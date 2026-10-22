const { contextBridge, ipcRenderer } = require('electron');
const invoke = channel => value => ipcRenderer.invoke(channel, value);
const on = channel => callback => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('peer', {
  snapshot: invoke('snapshot'), settings: invoke('settings'), copyInvite: invoke('invite-copy'),
  addFriend: invoke('friend-add'), acceptFriend: invoke('friend-accept'), removeFriend: invoke('friend-remove'),
  signal: invoke('signal-send'), saveChat: invoke('chat-save'), ackChat: invoke('chat-ack'), notify: invoke('notify'),
  pickFile: invoke('file-pick'), readFile: invoke('file-read'), receiveFile: invoke('file-receive'),
  writeFile: invoke('file-write'), finishFile: invoke('file-finish'), cancelFile: invoke('file-cancel'), reconnect: invoke('reconnect'),
  onState: on('state'), onSignal: on('signal'), onDisconnect: on('disconnect-peer')
});
