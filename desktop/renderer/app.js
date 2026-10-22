import { PeerTransport } from './transport.js';
const $ = id => document.getElementById(id);
let state, selected, toastTimer;
const statuses = new Map(), transferViews = new Map();
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 7000); }
function run(fn) { return async event => { event?.preventDefault(); try { await fn(event); } catch (e) { toast(e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')); } }; }
const transport = new PeerTransport(window.peer, {
  status(id, value) { statuses.set(id, value); renderConversation(); },
  transfer(value) { transferViews.set(transport.key(value.peer, value.id), value); renderTransfers(); },
  error: toast
});
function element(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
function render(next) {
  state = next; $('myName').textContent = state.name; $('myAvatar').textContent = state.name[0].toUpperCase();
  $('coordinatorStatus').textContent = state.online ? '● Coordinator connected' : '○ Reconnecting…';
  $('coordinatorStatus').title = state.error || state.coordinator;
  if (selected && !state.contacts.some(c => c.id === selected)) selected = null;
  $('friendCount').textContent = state.contacts.length;
  $('friends').replaceChildren();
  if (!state.contacts.length) $('friends').append(element('div', 'Your circle starts here. Share your invite or add a friend to get connected.', 'empty-contacts'));
  for (const c of state.contacts) {
    const b = element('button', undefined, `friend ${selected === c.id ? 'selected' : ''}`); b.dataset.peer = c.id;
    const info = element('div', undefined, 'details'); info.append(element('strong', c.name), element('small', c.status === 'incoming' ? 'Friend request' : c.status === 'outgoing' ? 'Request sent' : c.online ? 'Online' : 'Offline'));
    b.append(element('span', c.name[0].toUpperCase(), 'avatar'), info, element('span', undefined, `dot ${c.online ? 'online' : ''}`));
    b.onclick = () => { selected = c.id; render(state); }; $('friends').append(b);
  }
  transport.sync(state); renderConversation();
}
function renderConversation() {
  if (!state) return;
  const contact = state.contacts.find(c => c.id === selected);
  $('welcome').hidden = Boolean(contact); $('conversation').hidden = !contact;
  $('conversationTitle').textContent = contact?.name || 'A little closer, wherever you are.';
  $('connectionStatus').textContent = contact ? statuses.get(selected) || (contact.online ? 'Ready to connect' : 'Offline') : 'Choose a friend';
  if (!contact) return;
  $('fingerprint').textContent = `IDENTITY ${contact.id.slice(0, 12)}…${contact.id.slice(-8)}`; $('fingerprint').title = contact.id;
  $('pending').hidden = contact.status === 'accepted';
  $('pendingText').textContent = contact.status === 'incoming' ? `${contact.name} wants to connect. Compare the full identity fingerprint (hover above) through a trusted channel before accepting.` : 'Your request is waiting for acceptance. Leave both apps online so your friend can respond.';
  $('acceptFriend').hidden = contact.status !== 'incoming';
  const connected = contact.status === 'accepted' && transport.ready(selected);
  $('sendMessage').disabled = !connected; $('sendFile').disabled = !connected; $('messageInput').disabled = !connected;
  $('messageInput').placeholder = connected ? 'Message your friend…' : 'Waiting for a direct connection…';
  const list = $('messages'); const bottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80; list.replaceChildren();
  for (const m of state.history[selected] || []) {
    const block = element('div', undefined, `message ${m.direction}`);
    block.append(element('div', m.text, 'bubble'), element('small', `${new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${m.direction === 'out' ? m.delivered ? ' · Delivered' : ' · Unconfirmed' : ''}`)); list.append(block);
  }
  if (bottom) list.scrollTop = list.scrollHeight;
  renderTransfers();
}
function size(bytes) { return bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`; }
function renderTransfers() {
  $('transfers').replaceChildren();
  for (const view of [...transferViews.values()].filter(t => t.peer === selected).slice(-8)) {
    const t = transport.transfers.get(transport.key(view.peer, view.id));
    const card = element('div', undefined, 'transfer'); card.dataset.transfer = t.id;
    card.append(element('strong', `${t.direction === 'out' ? '↑' : '↓'} ${t.name}`), element('small', `${t.status} · ${size(t.progress)} / ${size(t.size)}`));
    const progress = element('progress'); progress.max = t.size || 1; progress.value = t.size ? t.progress : t.finished ? 1 : 0; card.append(progress);
    if (!t.finished) {
      if (t.direction === 'in' && !t.localId) { const accept = element('button', 'Accept file', 'primary'); accept.onclick = run(() => transport.accept(t)); card.append(accept); }
      const cancel = element('button', 'Cancel transfer'); cancel.onclick = run(() => transport.cancel(t)); card.append(cancel);
    }
    $('transfers').append(card);
  }
}
for (const id of ['addButton', 'welcomeAdd']) $(id).onclick = () => $('addDialog').showModal();
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => $(button.dataset.close).close());
$('addForm').onsubmit = run(async () => { selected = await peer.addFriend($('inviteInput').value); $('inviteInput').value = ''; $('addDialog').close(); render(await peer.snapshot()); toast('Request saved. It will reach your friend when both devices are online.'); });
$('copyInvite').onclick = run(async () => { await peer.copyInvite(); toast('Invite copied. Share it privately with your friend.'); });
$('settingsButton').onclick = () => { $('nameInput').value = state.name; $('coordinatorInput').value = state.coordinator; $('myFingerprint').textContent = state.id; $('settingsDialog').showModal(); };
$('settingsForm').onsubmit = run(async () => { await peer.settings({ name: $('nameInput').value, coordinator: $('coordinatorInput').value }); $('settingsDialog').close(); });
$('acceptFriend').onclick = run(() => peer.acceptFriend(selected));
$('removeFriend').onclick = () => $('removeDialog').showModal();
$('confirmRemove').onclick = run(async () => { await peer.removeFriend(selected); $('removeDialog').close(); });
$('retryPeer').onclick = run(async () => { transport.close(selected); await peer.reconnect(); });
$('sendFile').onclick = run(() => transport.offer(selected));
$('chatForm').onsubmit = run(async () => { const text = $('messageInput').value; await transport.chat(selected, text); $('messageInput').value = ''; $('messageInput').focus(); });
peer.onState(render);
peer.onSignal(data => transport.signal(data).catch(e => transport.fail(data.from, e)));
peer.onDisconnect(id => transport.close(id));
render(await peer.snapshot());
