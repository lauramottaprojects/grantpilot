(function () {
  const { API_BASE, FEED_URL, MODEL } = window.GRANTSEEKER;

  const STAGES = [
    { stage: 'researcher', name: 'Maeve', role: 'Researcher · Funding Analyst' },
    { stage: 'designer', name: 'Conor', role: 'Designer · Match Architect' },
    { stage: 'maker', name: 'Niamh', role: 'Maker · Prototype Engineer' },
    { stage: 'communicator', name: 'Orla', role: 'Communicator · Funding Storyteller' },
    { stage: 'manager', name: 'Eoin', role: 'Manager · Chief Sign-Off' },
  ];

  const $ = (id) => document.getElementById(id);
  const messagesEl = $('messages');
  const form = $('form');
  const input = $('input');
  const sendBtn = $('send');
  const liveDot = $('liveDot');
  const liveText = $('liveText');

  function setLive(state, text) {
    liveDot.className = 'dot' + (state === 'live' ? ' live' : state === 'err' ? ' err' : '');
    liveText.textContent = text;
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmt(text) {
    const lines = esc(text).split('\n');
    let html = '';
    let inList = false;
    for (const raw of lines) {
      const line = raw.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      if (/^\s*[-*•]\s+/.test(line)) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + line.replace(/^\s*[-*•]\s+/, '') + '</li>';
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        if (line.trim() === '') continue;
        html += '<div>' + line + '</div>';
      }
    }
    if (inList) html += '</ul>';
    return html;
  }

  function addUser(text) {
    const div = document.createElement('div');
    div.className = 'msg user';
    div.textContent = text;
    messagesEl.appendChild(div);
  }

  function addSystem(text) {
    const div = document.createElement('div');
    div.className = 'msg sys';
    div.textContent = text;
    messagesEl.appendChild(div);
  }

  function addCard(meta, i) {
    const div = document.createElement('div');
    div.className = 'card pending';
    div.id = 'card-' + meta.stage;
    div.innerHTML =
      '<div class="card-head">' +
      '<span class="num">' + (i + 1) + '</span>' +
      '<div class="who"><b>' + meta.name + '</b><span>' + meta.role + '</span></div>' +
      '<span class="spinner"></span>' +
      '</div><div class="card-body">Working…</div>';
    messagesEl.appendChild(div);
    return div;
  }

  function fillCard(meta, text) {
    const card = $('card-' + meta.stage);
    if (!card) return;
    card.classList.remove('pending');
    card.querySelector('.spinner').remove();
    card.querySelector('.card-body').innerHTML = fmt(text);
  }

  function fillCardError(meta, message) {
    const card = $('card-' + meta.stage);
    if (!card) return;
    card.classList.remove('pending');
    const head = card.querySelector('.card-head');
    head.removeChild(head.querySelector('.spinner'));
    card.querySelector('.card-body').innerHTML =
      '<div><strong>Agent unavailable.</strong> ' + esc(message) + '</div>';
  }

  function parseCsv(text) {
    const rows = [];
    let cur = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { cur.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        cur.push(field); field = '';
        if (cur.some((c) => c.trim() !== '')) rows.push(cur);
        cur = [];
      } else field += ch;
    }
    if (field !== '' || cur.length) { cur.push(field); rows.push(cur); }
    return rows;
  }

  async function fetchLiveCount() {
    const res = await fetch(FEED_URL);
    if (!res.ok) throw new Error('live feed HTTP ' + res.status);
    const rows = parseCsv(await res.text());
    return Math.max(0, rows.length - 1);
  }

  async function callAgent(stage, message, history) {
    const res = await fetch(API_BASE + '/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage, message, history }),
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok || !json || !json.ok) {
      throw new Error((json && json.error) || 'API returned HTTP ' + res.status);
    }
    return json;
  }

  async function runPipeline(message) {
    const history = [];
    addSystem('Live grants feed connected — ' + (await fetchLiveCount()).toLocaleString() + ' supports (Google Sheets). Five agents now working…');
    for (let i = 0; i < STAGES.length; i++) {
      const meta = STAGES[i];
      addCard(meta, i);
      try {
        const json = await callAgent(meta.stage, message, history);
        fillCard(meta, json.output);
        history.push({ id: json.agent.id, name: json.agent.name, role: json.agent.role, output: json.output });
      } catch (err) {
        fillCardError(meta, err.message);
        addSystem('Pipeline stopped: ' + meta.name + ' could not complete.');
        return;
      }
    }
    addSystem('All five agents complete — see each evidence card above.');
  }

  async function submit(text) {
    addUser(text);
    input.value = '';
    sendBtn.disabled = true;
    try {
      await runPipeline(text);
    } catch (err) {
      setLive('err', 'Live feed unreachable — retrying…');
      addSystem('Could not reach the live grants database: ' + err.message);
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    submit(text);
  });

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => submit(chip.dataset.example));
  });

  (async function init() {
    try {
      const count = await fetchLiveCount();
      setLive('live', count.toLocaleString() + ' live supports · Google Sheets · ' + MODEL);
    } catch (err) {
      setLive('err', 'Live feed unreachable: ' + err.message);
    }
  })();
})();
