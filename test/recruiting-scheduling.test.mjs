import test from 'node:test';
import assert from 'node:assert/strict';
import { createGas, event, unitVector } from './harness.mjs';
const owner = 'U' + '1'.repeat(32), jobId = 'a'.repeat(16);
const out = ms => ms.map(m => m.text || m.altText).join('\n');
function fixture(sourceMode) {
  const f = createGas({ sourceMode, text: '[[PUBLIC]]\n## 專案\n使用 Python 開發 API 工具，並使用 SQL 整理資料。\n## 聯絡方式\nEmail：owner@mock-company.dev\n[[/PUBLIC]]', properties: { OWNER_LINE_USER_ID: owner } }); let n = 0;
  f.model = call => {
    if (call.url.endsWith(':batchEmbedContents')) return { body: { embeddings: call.body.requests.map(() => ({ values: unitVector() })) } };
    if (call.body?.generationConfig?.responseSchema?.properties?.candidateEvidence) {
      const input = JSON.parse(call.body.contents[0].parts[0].text);
      const rows = input.requirements.map(r => { const quote = r.quote.includes('Python') ? '使用 Python 開發 API 工具' : '使用 SQL 整理資料'; const line = input.resume.find(l => l.text.includes(quote));
        return { requirementId: r.id, evidence: line ? [{ lineId: line.id, quote }] : [] }; });
      return { body: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ candidateEvidence: rows }) }] } }] } };
    }
    return { body: {} };
  };
  f.state.response = call => f.model(call); f.gas.syncKnowledgeBase();
  const cfg = f.gas.config_(), index = f.gas.loadIndex_(cfg), hit = index.chunks.find(c => c.text.includes('使用 Python'));
  const requirements = [{ id: '1'.repeat(12), quote: '具備 Python 專案經驗', kind: '必要' }, { id: '2'.repeat(12), quote: '使用過 SQL', kind: '加分' }];
  const results = Object.fromEntries(requirements.map(r => [r.id, { evidence: [{ id: hit.id, section: hit.section, quote: '使用 Python 開發 API 工具', imageKey: null }] }]));
  f.gas.updatePortfolioStore_(cfg, store => { store.jobGuides = { [f.gas.guideActor_('hr', cfg)]: { id: jobId, version: 2, job: '職缺：AI工程師\n必要條件：具備 Python 專案經驗\n加分條件：使用過 SQL', requirements,
    requirementsConfirmed: true, results, fingerprint: index.fingerprint, stage: 'complete', events: [], expiresAt: Date.now() + 86400000, updatedAt: Date.now(), interview: { id: 'f'.repeat(12), revision: 3,
      origin: '測試補充', answers: ['一', '二', '三'], questions: requirements.concat(requirements[0]).map((r, i) => ({ id: String(i).repeat(12), requirementId: r.id, text: '問題 ' + i })),
      followups: requirements.concat(requirements[0]).map(r => ({ requirementId: r.id, text: '請說明你的實際貢獻及驗證方式？' })) } } }; });
  f.state.calls.length = 0;
  f.e = (text, user = 'hr', id) => { const e = event(text, id || 'new-' + ++n); e.source.userId = user; if (/^(rc|slot|jg|invite):/.test(text)) { e.type = 'postback'; e.postback = { data: text }; } return e; };
  f.recruit = (text, user = 'hr', id) => f.gas.handleRecruiting_(f.e(text, user, id), text, cfg);
  f.slot = (text, user = 'hr') => f.gas.handleScheduling_(f.e(text, user), text, cfg);
  f.send = (text, user = 'hr', id) => { f.gas.handleEvent_(f.e(text, user, id), cfg); return f.state.calls.filter(c => c.url.endsWith('/message/reply')).at(-1).body.messages; };
  f.read = () => f.gas.guideRead_('hr', cfg);
  f.draft = user => f.gas.invitationDraft_(f.gas.invitationKey_(user || 'hr', cfg));
  f.addCandidate = (name, resume, id) => { f.recruit('rc:add:' + jobId); return f.recruit('候選人代號：' + name + '\n履歷：\n' + resume, 'hr', id); };
  f.publish = (offset = 0) => {
    const start = Math.ceil((Date.now() + 2 * 86400000 + offset) / 60000) * 60000, end = start + 3600000;
    const input = [start, end].map(t => new Date(t + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ')).join(' / ');
    f.slot('slot:add', owner); f.slot(input, owner);
    return Object.values(f.gas.loadPortfolioStore_(cfg).scheduling.slots).find(s => Date.parse(s.start) === start);
  };
  return f;
}

for (const mode of [undefined, 'bundle']) test('private candidate imports, heatmap and coverage sorting with human-only decisions: ' + (mode || 'sources'), () => {
  const f = fixture(mode);
  f.addCandidate('A', '使用 Python 開發 API 工具，負責錯誤處理與驗證。\n性別：男\n年齡：30');
  f.addCandidate('B', '使用 SQL 整理資料，設計報表及查核流程，並向團隊說明成果。');
  const all = Object.values(f.read().recruiting.candidates); assert.equal(all.length, 2);
  const heat = f.recruit('rc:heat:' + jobId); assert.equal(heat[1].type, 'flex'); assert.match(out(heat), /不代表能力高低/);
  const sorted = out(f.recruit('rc:rank:' + jobId)); assert(sorted.indexOf('A') < sorted.indexOf('B')); assert.match(sorted, /50%/); assert.match(sorted, /不自動淘汰或錄取/);
  assert(!all.some(c => c.decision));
  const api = f.state.calls.filter(c => c.body?.generationConfig?.responseSchema?.properties?.candidateEvidence);
  const userPayloads = api.map(c => c.body.contents);
  assert(!JSON.stringify(userPayloads).includes('性別')); assert(!JSON.stringify(userPayloads).includes('年齡'));
  assert.match(out(f.recruit('rc:view:' + jobId + ':' + all[0].id, 'other')), /先貼職缺/);
  f.recruit('rc:choose:' + jobId + ':' + all[0].id + ':offer');
  assert(!f.read().recruiting.candidates[all[0].id].decision);
  f.recruit('根據 Python 專案實際工作內容與面談證據，人工決定錄取。');
  const token = f.read().recruiting.input.token;
  f.recruit('rc:confirm:' + jobId + ':' + all[0].id + ':' + token);
  assert.equal(f.read().recruiting.candidates[all[0].id].decision.label, '錄取（人工記錄）');
  assert(!f.state.calls.some(c => c.url.endsWith('/push')));
});

test('invalid candidate citations never add a record and replay never adds another candidate or reaches normal RAG', () => {
  const f = fixture(), original = f.model;
  f.model = call => { const r = original(call); if (call.body?.generationConfig?.responseSchema?.properties?.candidateEvidence) {
    const value = JSON.parse(r.body.candidates[0].content.parts[0].text); value.candidateEvidence[0].evidence[0].quote = '從未記載的工作成果'; r.body.candidates[0].content.parts[0].text = JSON.stringify(value);
  } return r; };
  const resume = '候選人代號：A\n履歷：\n使用 Python 開發 API 工具，負責錯誤處理與驗證。';
  f.recruit('rc:add:' + jobId); assert.match(out(f.recruit(resume)), /未通過核對/); assert.equal(Object.keys(f.read().recruiting.candidates).length, 0);
  f.model = original; f.send(resume, 'hr', 'replayed-candidate');
  const before = f.state.calls.filter(c => c.body?.generationConfig).length;
  f.recruit(resume, 'hr', 'replayed-candidate'); assert.equal(Object.keys(f.read().recruiting.candidates).length, 1);
  assert.equal(f.state.calls.filter(c => c.body?.generationConfig).length, before); assert.equal(f.state.documentWrites, 0);
});

test('unrelated personal criteria are excluded from the denominator and stale owner evidence cannot be ranked', () => {
  const f = fixture(), cfg = f.gas.config_();
  f.gas.guideChange_('hr', cfg, (rows, actor) => { rows[actor].requirements.push({ id: '3'.repeat(12), quote: '年齡三十歲以下', kind: '必要' }); rows[actor].results['3'.repeat(12)] = { evidence: [] }; });
  f.addCandidate('A', '使用 Python 開發 API 工具，負責錯誤處理與驗證。');
  const c = Object.values(f.read().recruiting.candidates)[0]; assert.equal(f.gas.recruitingStats_(f.read(), c).total, 2);
  f.recruit('rc:owner:' + jobId); f.state.text = f.state.text.replace('Python', 'Java');
  assert.match(out(f.recruit('rc:rank:' + jobId)), /原履歷已更新/);
  const ownerCandidate = Object.values(f.read().recruiting.candidates).find(c => c.kind === 'owner');
  assert.match(out(f.recruit('rc:source:' + jobId + ':' + ownerCandidate.id)), /原履歷已更新/);
});

for (const mode of [undefined, 'bundle']) test('prefilled invitation previews context, skips duplicate job entry and remains editable: ' + (mode || 'sources'), () => {
  const f = fixture(mode); const start = f.send('jg:invite:' + jobId);
  assert.match(out(start), /已帶入職稱/); assert.match(f.draft().fields.message, /AI工程師/);
  f.send('公司與稱呼'); assert.equal(f.draft().step, 2); f.send('hr@mock-company.dev'); f.send('不限定');
  const draft = f.draft(); assert.equal(draft.step, 4);
  assert.match(out(f.send('invite:editmessage:' + draft.id)), /職缺或合作內容/);
  f.send('修改後的職缺與待確認問題'); assert.equal(f.draft().step, 4);
  f.send('invite:submit:' + draft.id); const store = f.gas.loadPortfolioStore_(f.gas.config_());
  assert.equal(store.invitations[draft.id].fields.message, '修改後的職缺與待確認問題'); assert.match(store.invitations[draft.id].context.job, /AI工程師/);
  assert(f.state.emails[0].body.includes('本次職缺原文'));
});

for (const mode of [undefined, 'bundle']) test('slots hold privately, final booking is atomic with invitation, and another visitor cannot double-book: ' + (mode || 'sources'), () => {
  const f = fixture(mode), slot = f.publish(); assert(slot);
  assert.match(out(f.slot('slot:admin', 'other')), /只有已設定/);
  f.send('jg:invite:' + jobId); f.send('公司'); f.send('hr@mock-company.dev'); const draft = f.draft();
  assert.match(out(f.slot('slot:pick:' + slot.id + ':' + draft.id)), /暫留五分鐘/); assert.equal(f.draft().step, 4);
  assert(!out(f.slot('slot:list', 'other')).includes(f.gas.schedulingLabel_(slot)));
  assert.match(out(f.slot('slot:pick:' + slot.id, 'other')), /剛被保留/);
  f.send('invite:submit:' + draft.id); const data = f.gas.loadPortfolioStore_(f.gas.config_());
  assert.equal(data.scheduling.slots[slot.id].bookingId, draft.id); assert.equal(data.invitations[draft.id].booking.status, 'reserved');
  const sends = f.state.calls.filter(c => c.url.endsWith('/push')).length;
  f.send('invite:submit:' + draft.id); assert.equal(f.state.calls.filter(c => c.url.endsWith('/push')).length, sends);
  assert.match(out(f.slot('slot:cancel:' + draft.id, 'other')), /找不到/);
  f.slot('slot:cancelok:' + draft.id); const after = f.gas.loadPortfolioStore_(f.gas.config_());
  assert.equal(after.scheduling.bookings[draft.id].status, 'cancelled'); assert(!after.scheduling.slots[slot.id].bookingId);
});

test('hold expiry rejects submit without sending mail; overlap and cancellation release rules are enforced', () => {
  const f = fixture(), slot = f.publish(), cfg = f.gas.config_();
  const same = [slot.start, slot.end].map(t => new Date(Date.parse(t) + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ')).join(' / ');
  f.slot('slot:add', owner); assert.match(out(f.slot(same, owner)), /重疊/); f.slot('取消', owner);
  f.send('jg:invite:' + jobId); f.send('公司'); f.send('hr@mock-company.dev'); const draft = f.draft(); f.slot('slot:pick:' + slot.id + ':' + draft.id);
  f.gas.updatePortfolioStore_(cfg, store => { store.scheduling.slots[slot.id].hold.until = 1; });
  assert.match(out(f.send('invite:submit:' + draft.id)), /暫留已過期/); assert.equal(f.state.emails.length, 0);
  assert(!f.gas.loadPortfolioStore_(cfg).invitations?.[draft.id]);
  f.slot('slot:pick:' + slot.id + ':' + draft.id); f.send('invite:cancel');
  assert(!f.gas.loadPortfolioStore_(cfg).scheduling.slots[slot.id].hold);
});

test('home actions use aligned footers and a single primary action without stacked gray secondary buttons', () => {
  const f = fixture(); const home = f.send('首頁')[0];
  const cards = home.contents.contents; assert.equal(new Set(cards.map(c => c.footer.height)).size, 1);
  const first = cards[0].footer.contents; assert.equal(first.find(b => b.action.data === 'jg:start').style, 'primary');
  assert(first.filter(b => b.action.data !== 'jg:start').every(b => b.style === 'link'));
  assert(cards[2].footer.contents.some(b => b.action.data === 'rc:menu'));
});

test('cancelled candidate analysis cannot save its late result', () => {
  const f = fixture(), original = f.model; let cancelled = false;
  f.model = call => { if (call.body?.generationConfig?.responseSchema?.properties?.candidateEvidence && !cancelled) {
    cancelled = true; f.recruit('rc:cancel:' + jobId);
  } return original(call); };
  assert.match(out(f.addCandidate('A', '使用 Python 開發 API 工具，負責錯誤處理與驗證。')), /操作已取消/);
  assert.equal(Object.keys(f.read().recruiting.candidates).length, 0);
});

test('failure saving invitation and booking leaves no reservation or notification, and retry can succeed', () => {
  const f = fixture(), slot = f.publish(), cfg = f.gas.config_();
  f.send('jg:invite:' + jobId); f.send('公司'); f.send('hr@mock-company.dev'); const draft = f.draft();
  f.slot('slot:pick:' + slot.id + ':' + draft.id);
  const file = f.state.files.get(f.state.properties.get('PORTFOLIO_STORE_FILE_ID')), original = file.setContent;
  file.setContent = value => { if (JSON.parse(value).invitations?.[draft.id]) throw new Error('simulated-save-failure'); return original(value); };
  assert.match(out(f.send('invite:submit:' + draft.id)), /尚未保存成功/);
  assert(!f.gas.loadPortfolioStore_(cfg).scheduling.slots[slot.id].bookingId); assert.equal(f.state.emails.length, 0);
  file.setContent = original; f.send('invite:submit:' + draft.id);
  assert.equal(f.gas.loadPortfolioStore_(cfg).scheduling.slots[slot.id].bookingId, draft.id);
  assert.equal(f.state.emails.length, 1);
});

test('at most five candidates are retained and fabricated slot or booking IDs cannot access another record', () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) f.addCandidate('候選 ' + i, '使用 Python 開發 API 工具，負責錯誤處理與驗證。');
  assert.match(out(f.recruit('rc:add:' + jobId)), /最多五位/);
  assert.match(out(f.recruit('rc:owner:' + jobId)), /五位候選人上限/);
  assert.equal(Object.keys(f.read().recruiting.candidates).length, 5);
  assert.match(out(f.slot('slot:pick:toString')), /已失效/);
  assert.match(out(f.slot('slot:cancelok:constructor')), /已失效/);
});

test('expired schedule input is not routed into resume questions or AI', () => {
  const f = fixture(), cfg = f.gas.config_(); f.slot('slot:add', owner);
  f.gas.updatePortfolioStore_(cfg, store => { store.scheduling.inputs[f.gas.invitationVisitor_(owner)].expiresAt = 1; });
  const before = f.state.calls.filter(c => c.url.includes('generativelanguage')).length;
  assert.match(out(f.send('2030-01-01 14:00 / 2030-01-01 14:30', owner)), /輸入已過期/);
  assert.equal(f.state.calls.filter(c => c.url.includes('generativelanguage')).length, before);
  assert.equal(f.state.documentWrites, 0);
});
