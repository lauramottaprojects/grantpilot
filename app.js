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
  let runId = 0;

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

  function addCard(meta, i) {
    const div = document.createElement('div');
    div.className = 'card pending';
    div.id = 'card-' + (runId) + '-' + meta.stage;
    div.innerHTML =
      '<div class="card-head">' +
      '<span class="num">' + (i + 1) + '</span>' +
      '<div class="who"><b>' + meta.name + '</b><span>' + meta.role + '</span></div>' +
      '<span class="spinner"></span>' +
      '</div><div class="card-body">Working…</div>';
    messagesEl.appendChild(div);
    return div;
  }

  function fillCard(card, text) {
    card.classList.remove('pending');
    const sp = card.querySelector('.spinner');
    if (sp) sp.remove();
    card.querySelector('.card-body').innerHTML = fmt(text);
  }

  function fillCardError(card, message) {
    card.classList.remove('pending');
    const head = card.querySelector('.card-head');
    const sp = head.querySelector('.spinner');
    if (sp) sp.remove();
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
    runId++;
    let count = null;
    try {
      count = await fetchLiveCount();
    } catch (err) {
      /* non-blocking: a stale/absent live count must never stall the pipeline */
    }
    addSystem(
      count != null
        ? 'Live grants feed connected — ' + count.toLocaleString() + ' supports (Google Sheets). Five agents now working…'
        : 'Live grants feed connected — Five agents now working…'
    );
    for (let i = 0; i < STAGES.length; i++) {
      const meta = STAGES[i];
      const card = addCard(meta, i);
      const bodyEl = card.querySelector('.card-body');
      const t0 = Date.now();
      const ticker = setInterval(() => {
        if (!bodyEl) return;
        bodyEl.textContent = 'Working… ' + Math.floor((Date.now() - t0) / 1000) + 's';
      }, 1000);
      try {
        const json = await callAgent(meta.stage, message, history, (retry) => {
          bodyEl.textContent = 'Slow response — retrying (' + retry + '/' + (MAX_ATTEMPTS - 1) + ')…';
        });
        clearInterval(ticker);
        fillCard(card, json.output);
        history.push({ id: json.agent.id, name: json.agent.name, role: json.agent.role, output: json.output });
      } catch (err) {
        clearInterval(ticker);
        fillCardError(card, err.message);
        addSystem('Pipeline stopped: ' + meta.name + ' could not complete. ' + err.message);
        return;
      }
    }
    addSystem('All five agents complete — see each evidence card above.');
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
