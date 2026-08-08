(function () {
  const { API_BASE, FEED_URL, MODEL } = window.GRANTSEEKER;

  const REQUEST_TIMEOUT_MS = 25000;
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 1500;

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

  const convo = [];
  let feedCount = null;

  function setLive(state, text) {
    liveDot.className = 'dot' + (state === 'live' ? ' live' : state === 'err' ? ' err' : '');
    liveText.textContent = text;
  }

  function setBusy(busy) {
    sendBtn.disabled = busy;
    document.querySelectorAll('.chip').forEach((c) => { c.disabled = busy; });
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmt(text) {
    const lines = esc(text).split('\n');
    let html = '';
    let inList = false;
    let inTable = false;
    const closeTable = () => { if (inTable) { html += '</table>'; inTable = false; } };
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();
      const isTableRow = trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.split('|').length >= 3;
      const isSep = isTableRow && /^[|\s:.-]+$/.test(trimmed) && /-/.test(trimmed);
      if (isTableRow) {
        if (isSep) continue;
        if (!inTable) { html += '<table>'; inTable = true; }
        const cells = trimmed.replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'));
        html += '<tr>' + cells.map((c) => '<td>' + c + '</td>').join('') + '</tr>';
        continue;
      }
      closeTable();
      if (/^\s*[-*•]\s+/.test(trimmed)) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + trimmed.replace(/^\s*[-*•]\s+/, '') + '</li>';
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        if (trimmed === '') continue;
        html += '<div>' + trimmed + '</div>';
      }
    }
    if (inList) html += '</ul>';
    closeTable();
    return html;
  }

  function addUser(text) {
    const div = document.createElement('div');
    div.className = 'msg user';
    div.textContent = text;
    messagesEl.appendChild(div);
  }

  function addBot(text) {
    const div = document.createElement('div');
    div.className = 'msg bot';
    div.innerHTML = fmt(text);
    messagesEl.appendChild(div);
  }

  function addSystem(text) {
    const div = document.createElement('div');
    div.className = 'msg sys';
    div.textContent = text;
    messagesEl.appendChild(div);
  }

  const STEP_OF = { researcher: 1, designer: 2, maker: 2, communicator: 3, manager: 3 };
  const pillsByStep = { 1: [], 2: [], 3: [] };

  function showStatusPanel() {
    $('statusPanel').classList.remove('hidden');
    $('resultsPanel').classList.add('hidden');
    document.querySelectorAll('#steps > li').forEach((li) => li.classList.remove('done', 'err'));
    document.querySelectorAll('.agent-pill').forEach((p) => p.remove());
    pillsByStep[1] = []; pillsByStep[2] = []; pillsByStep[3] = [];
    if (feedCount != null) $('liveCount').textContent = feedCount.toLocaleString() + ' live supports';
    else $('liveCount').textContent = '';
  }

  function addAgentPill(meta, step) {
    const d = document.createElement('details');
    d.className = 'agent-pill working';
    d.innerHTML =
      '<summary>' +
      '<span class="pill-tick"></span>' +
      '<span class="pill-who"><b>' + meta.name + '</b><span>' + meta.role + '</span></span>' +
      '<span class="pill-state">Working…</span>' +
      '</summary><div class="agent-out"></div>';
    pillsByStep[step].push(d);
    $('agents-' + step).appendChild(d);
    return d;
  }

  function setPill(pill, state, payload) {
    pill.classList.remove('working');
    const stateEl = pill.querySelector('.pill-state');
    const out = pill.querySelector('.agent-out');
    if (state === 'done') {
      pill.classList.add('done');
      stateEl.textContent = '✓ Done';
      out.innerHTML = fmt(payload);
    } else if (state === 'err') {
      pill.classList.add('err');
      stateEl.textContent = '✕ Failed';
      out.innerHTML = '<div><strong>Agent unavailable.</strong> ' + esc(payload) + '</div>';
    } else if (state === 'retry') {
      pill.classList.add('working');
      stateEl.textContent = 'Retrying (' + payload + '/' + (MAX_ATTEMPTS - 1) + ')…';
    }
  }

  function markStepDone(step) {
    const li = document.querySelector('#steps > li[data-step="' + step + '"]');
    if (!li) return;
    if (pillsByStep[step].some((p) => p.classList.contains('err'))) {
      li.classList.remove('done');
      li.classList.add('err');
    } else if (pillsByStep[step].every((p) => p.classList.contains('done'))) {
      li.classList.add('done');
    }
  }

  function showResults(matched) {
    const body = $('resultsBody');
    body.innerHTML = '';
    const rows = matched.slice(0, 10);
    if (!rows.length) return;
    for (const r of rows) {
      const tr = document.createElement('tr');
      const prog = r['Programme Name'] || 'Unnamed programme';
      const amount = r['Max Amount (EUR)'] || 'Not published';
      const deadline = r['Deadline'] || 'Open-ended';
      const link = r['URL'] || '';
      tr.innerHTML =
        '<td class="prog">' + esc(prog) + '</td>' +
        '<td>' + esc(r['Agency'] || '—') + '</td>' +
        '<td>' + esc(r['Support Type'] || '—') + '</td>' +
        '<td>' + esc(amount) + '</td>' +
        '<td>' + esc(deadline) + '</td>' +
        '<td>' + (link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">Apply ↗</a>' : '—') + '</td>';
      body.appendChild(tr);
    }
    $('resultsPanel').classList.remove('hidden');
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

  async function fetchWithTimeout(url, options, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { ...options, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchLiveCount() {
    if (feedCount != null) return feedCount;
    const res = await fetchWithTimeout(FEED_URL, {}, 12000);
    if (!res.ok) throw new Error('live feed HTTP ' + res.status);
    const rows = parseCsv(await res.text());
    feedCount = Math.max(0, rows.length - 1);
    return feedCount;
  }

  async function callAgent(stage, message, history, onRetry) {
    let lastErr = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetchWithTimeout(API_BASE + '/api/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage, message, history }),
        }, REQUEST_TIMEOUT_MS);
        let json = null;
        try { json = await res.json(); } catch (e) { /* non-JSON body */ }
        if (!res.ok || !json || !json.ok) {
          const err = new Error((json && json.error) || 'API returned HTTP ' + res.status);
          err.status = res.status;
          throw err;
        }
        return json;
      } catch (err) {
        lastErr = err;
        const retryable =
          attempt < MAX_ATTEMPTS &&
          (err.name === 'AbortError' || err.status === undefined || err.status >= 500);
        if (!retryable) break;
        if (onRetry) onRetry(attempt);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
    if (lastErr && lastErr.name === 'AbortError') {
      throw new Error('the agent request timed out after ' + Math.round(REQUEST_TIMEOUT_MS / 1000) + ' seconds — please try again');
    }
    throw lastErr;
  }

  async function callIntake(convo) {
    const res = await fetchWithTimeout(API_BASE + '/api/intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: convo }),
    }, REQUEST_TIMEOUT_MS);
    let json = null;
    try { json = await res.json(); } catch (e) { /* non-JSON body */ }
    if (!res.ok || !json || !json.ok) {
      throw new Error((json && json.error) || 'intake API returned HTTP ' + res.status);
    }
    return json;
  }

  async function runPipeline(message) {
    const history = [];
    showStatusPanel();
    addSystem('Five agents are at work — follow their progress in the panel →');
    let search = null;
    for (let i = 0; i < STAGES.length; i++) {
      const meta = STAGES[i];
      const step = STEP_OF[meta.stage];
      const pill = addAgentPill(meta, step);
      let json;
      try {
        json = await callAgent(meta.stage, message, history, (retry) => {
          setPill(pill, 'retry', retry);
        });
      } catch (err) {
        setPill(pill, 'err', err.message);
        markStepDone(step);
        addSystem('Pipeline stopped: ' + meta.name + ' could not complete. ' + err.message);
        return;
      }
      setPill(pill, 'done', json.output);
      history.push({ id: json.agent.id, name: json.agent.name, role: json.agent.role, output: json.output });
      if (meta.stage === 'researcher') search = json.search;
      markStepDone(step);
      if (meta.stage === 'manager') {
        addBot(json.output);
        if (search && search.executed && search.matched && search.matched.length) {
          showResults(search.matched);
        }
        addSystem('All five agents complete — your matches are in the table above.');
      }
    }
  }

  async function submit(text) {
    addUser(text);
    input.value = '';
    setBusy(true);
    convo.push({ role: 'user', text });
    try {
      const intake = await callIntake(convo);
      if (intake.reply) {
        convo.push({ role: 'assistant', text: intake.reply });
        addBot(intake.reply);
      }
      if (intake.intent === 'run_pipeline') {
        await runPipeline(convo.filter((m) => m.role === 'user').map((m) => m.text).join(' '));
      }
    } catch (err) {
      setLive('err', 'Chatbot unreachable — retrying…');
      addSystem('Could not reach the chatbot: ' + err.message);
    } finally {
      setBusy(false);
      input.focus();
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (sendBtn.disabled) return;
    const text = input.value.trim();
    if (!text) return;
    submit(text);
  });

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (chip.disabled) return;
      submit(chip.dataset.example);
    });
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
