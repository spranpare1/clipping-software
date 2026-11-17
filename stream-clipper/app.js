const grid = document.querySelector('#agent-grid');
const clipsEl = document.querySelector('#clip-grid');
const toast = document.querySelector('#toast');
let appState = null;
let toastTimer;
const dirtyForms = new Map();
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const timeAgo = (iso) => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
};
function notify(message, error = false) {
  toast.textContent = message; toast.classList.toggle('error', error); toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
async function refresh() {
  try { appState = await request('/api/state'); render(); }
  catch { notify('Local agent disconnected. Restart it from the terminal.', true); }
}
function render() {
  if (!appState) return;
  const active = appState.agents.filter((agent) => agent.enabled).length;
  document.querySelector('#agents-running').textContent = `${active} of 5 agents enabled`;
  const allClips = appState.agents.flatMap((agent) => agent.clips.map((clip) => ({ ...clip, agentName: agent.name }))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  document.querySelector('#clip-count').textContent = `${allClips.length} clip${allClips.length === 1 ? '' : 's'}`;
  grid.innerHTML = appState.agents.map((agent, index) => {
    const connected = agent.obs.connected;
    const status = connected ? (agent.obs.replayBufferActive ? 'BUFFER READY' : 'BUFFER OFF') : (agent.obs.error ? 'NEEDS ATTENTION' : (agent.enabled ? 'NOT CONNECTED' : 'PAUSED'));
    const statusClass = connected && agent.obs.replayBufferActive ? 'ok' : '';
    const events = agent.events.slice(0, 2).map((event) => `<div class="event-row"><time>${timeAgo(event.at)}</time><div><b>${escapeHtml(event.message)}</b>${event.detail ? ` · ${escapeHtml(event.detail)}` : ''}</div></div>`).join('');
    return `<article class="agent-card ${agent.enabled ? '' : 'disabled'}" data-agent="${agent.id}">
      <div class="agent-top"><div class="agent-id"><div class="agent-orb">0${index + 1}</div><div><h3>${escapeHtml(agent.name)}</h3><span>${escapeHtml(agent.sourceName || 'No source label')} · OBS ${escapeHtml(agent.obsHost)}:${agent.obsPort}</span></div></div><div class="agent-status ${statusClass}"><i></i>${status}</div></div>
      <div class="agent-body">
        <div class="field"><label>AGENT NAME</label><input name="name" value="${escapeHtml(agent.name)}" maxlength="80"></div>
        <div class="field"><label>STREAM / SOURCE LABEL</label><input name="sourceName" value="${escapeHtml(agent.sourceName)}" placeholder="Twitch channel / stream"></div>
        <div class="field"><label>OBS HOST</label><input name="host" value="${escapeHtml(agent.obsHost)}" placeholder="127.0.0.1"></div>
        <div class="field"><label>OBS WEBSOCKET PORT</label><input name="port" type="number" value="${agent.obsPort}" min="1" max="65535"></div>
        <div class="field full"><label>OBS PASSWORD <span style="color:#5d6877">(session only)</span></label><input name="password" type="password" placeholder="Leave blank if no password" autocomplete="new-password"></div>
        <div class="field full"><label>CLIP CRITERIA · PER AGENT</label><textarea name="criteria" placeholder="Tell this agent what moments to clip. Example: clutch saves, funny reactions, boss fights…">${escapeHtml(agent.criteria)}</textarea></div>
        <div class="field"><label>TWITCH CHAT CHANNEL</label><input name="twitchChannel" value="${escapeHtml(agent.twitchChannel)}" placeholder="channelname"></div>
        <div class="field"><label>YOUTUBE LIVE CHAT ID</label><input name="youtubeLiveChatId" value="${escapeHtml(agent.youtubeLiveChatId)}" placeholder="Requires Google OAuth token"></div>
        <div class="field"><label>SPIKE WINDOW · SECONDS</label><input name="windowSeconds" type="number" min="5" max="120" value="${agent.windowSeconds}"></div>
        <div class="field"><label>MESSAGES TO TRIGGER</label><input name="minMessages" type="number" min="3" max="100" value="${agent.minMessages}"></div>
        <div class="field full"><label>CHAT SPIKE AUTOMATION</label><label class="auto-check"><input name="autoSaveHype" type="checkbox" ${agent.autoSaveHype ? 'checked' : ''}> Save replay on a chat activity spike <span style="color:#697587">· Twitch ${escapeHtml(agent.chat.twitch)} / YouTube ${escapeHtml(agent.chat.youtube)}</span></label></div>
      </div>
      <div class="agent-actions"><button class="button primary mini" data-action="save-settings">Save settings</button><button class="button secondary mini" data-action="connect">${connected ? 'Reconnect OBS' : 'Connect OBS'}</button><button class="button secondary mini" data-action="save-clip" ${connected && agent.obs.replayBufferActive ? '' : 'disabled'}>● Save replay</button><label class="auto-check"><input name="enabled" type="checkbox" ${agent.enabled ? 'checked' : ''}> Agent enabled</label><span class="replay-indicator">${agent.clips.length} saved</span></div>
      ${agent.obs.error ? `<p class="microcopy" style="color:#f2a5a0">${escapeHtml(agent.obs.error)}</p>` : ''}
      <p class="microcopy">Criteria are stored per agent; current automation detects chat spikes. Event specific visual/audio matching is not active yet. Set OBS replay duration to your desired clip length / pre-roll.</p>
      ${events ? `<div class="agent-events">${events}</div>` : ''}
    </article>`;
  }).join('');
  for (const [id, fields] of dirtyForms) {
    const card = grid.querySelector(`[data-agent="${id}"]`);
    if (!card) continue;
    for (const [name, value] of Object.entries(fields)) {
      const field = card.querySelector(`[name="${name}"]`);
      if (field) field.type === 'checkbox' ? field.checked = value : field.value = value;
    }
  }
  clipsEl.innerHTML = allClips.length ? allClips.slice(0, 18).map((clip) => {
    const previewable = /\.(mp4|webm|mov)$/i.test(clip.filename);
    const preview = previewable ? `<video class="clip-preview" controls preload="metadata" src="/api/clips/${encodeURIComponent(clip.id)}#t=0.5"></video>` : `<div class="clip-visual">◉<span class="clip-duration">DOWNLOAD TO PREVIEW</span></div>`;
    return `<article class="clip-card">${preview}<div class="clip-info"><b>${escapeHtml(clip.agentName)} · ${escapeHtml(clip.source)}</b><p>${escapeHtml(clip.reason)}</p><div class="clip-meta"><span>${timeAgo(clip.createdAt)} · ${formatBytes(clip.bytes)}</span><a href="/api/clips/${encodeURIComponent(clip.id)}?download=1">Download ↓</a></div></div></article>`;
  }).join('') : '<div class="empty-state">No replays saved yet. Connect an agent to OBS and use “Save replay”.</div>';
}
function formatBytes(bytes = 0) { if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`; return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function values(card) {
  const get = (name) => card.querySelector(`[name="${name}"]`);
  return {
    name: get('name').value, sourceName: get('sourceName').value, host: get('host').value, port: get('port').value,
    password: get('password').value, criteria: get('criteria').value, twitchChannel: get('twitchChannel').value,
    youtubeLiveChatId: get('youtubeLiveChatId').value, windowSeconds: get('windowSeconds').value,
    minMessages: get('minMessages').value, autoSaveHype: get('autoSaveHype').checked, enabled: get('enabled').checked,
    multiplier: appState.agents.find((agent) => agent.id === card.dataset.agent).multiplier,
    cooldownSeconds: appState.agents.find((agent) => agent.id === card.dataset.agent).cooldownSeconds,
    preRollSeconds: appState.agents.find((agent) => agent.id === card.dataset.agent).preRollSeconds
  };
}
async function saveSettings(card) {
  const body = values(card);
  await request(`/api/agents/${card.dataset.agent}/settings`, { method: 'PUT', body: JSON.stringify(body) });
  dirtyForms.delete(card.dataset.agent);
  if (body.password) card.querySelector('[name="password"]').value = '';
  await refresh();
}
function rememberForm(event) {
  const field = event.target.closest('[name]');
  const card = field?.closest('.agent-card');
  if (!field || !card || field.name === 'password') return;
  const current = dirtyForms.get(card.dataset.agent) || {};
  current[field.name] = field.type === 'checkbox' ? field.checked : field.value;
  dirtyForms.set(card.dataset.agent, current);
}
grid.addEventListener('input', rememberForm);
grid.addEventListener('change', rememberForm);
grid.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]'); if (!button) return;
  const card = button.closest('.agent-card'); const action = button.dataset.action; const id = card.dataset.agent;
  button.disabled = true;
  try {
    if (action === 'save-settings') { await saveSettings(card); notify('Agent settings saved.'); }
    if (action === 'connect') {
      const data = values(card);
      await request(`/api/agents/${id}/settings`, { method: 'PUT', body: JSON.stringify(data) });
      await request(`/api/agents/${id}/connect`, { method: 'POST', body: JSON.stringify({ host: data.host, port: data.port, password: data.password || undefined }) });
      dirtyForms.delete(id);
      await refresh(); notify('OBS connected. Replay Buffer is ready.');
    }
    if (action === 'save-clip') {
      await request(`/api/agents/${id}/save`, { method: 'POST', body: JSON.stringify({ reason: 'Manual save' }) });
      await refresh(); notify('Replay copied to this agent’s clip folder.');
    }
  } catch (error) { notify(error.message, true); await refresh(); }
  finally { button.disabled = false; }
});
document.querySelector('#stop-all').addEventListener('click', async () => {
  try { await request('/api/stop-auto', { method: 'POST', body: '{}' }); for (const fields of dirtyForms.values()) delete fields.autoSaveHype; await refresh(); notify('Automatic chat saves paused for all agents.'); }
  catch (error) { notify(error.message, true); }
});
document.addEventListener('keydown', async (event) => {
  if (!(event.ctrlKey && event.shiftKey && event.code === 'KeyS')) return;
  const active = document.activeElement;
  if (active && ['INPUT', 'TEXTAREA'].includes(active.tagName)) return;
  const agent = appState?.agents.find((item) => item.enabled && item.obs.connected && item.obs.replayBufferActive);
  if (!agent) return notify('No connected active agent is ready to save.', true);
  try { await request(`/api/agents/${agent.id}/save`, { method: 'POST', body: JSON.stringify({ reason: 'Keyboard shortcut (Ctrl+Shift+S)' }) }); await refresh(); notify(`Saved replay from ${agent.name}.`); }
  catch (error) { notify(error.message, true); }
});
refresh(); setInterval(refresh, 2500);
