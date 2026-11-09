import test from 'node:test';
import assert from 'node:assert/strict';
import { createGas, event, unitVector } from './harness.mjs';
const job = '職缺：AI工程師\n工作內容：使用 Python 開發應用與串接 API\n必要條件：具備 Python 專案經驗\n加分條件：使用過 SQL';
const quotes = ['使用 Python 開發應用與串接 API', '具備 Python 專案經驗', '使用過 SQL'];
const source = '[[PUBLIC]]\n## 專案：資料工具\n使用 Python 開發 API 工具，負責錯誤處理。\n[[/PUBLIC]]';
const output = ms => ms.map(m => m.text || m.altText).join('\n');
function fixture(sourceMode) {
  const f = createGas({ text: source, sourceMode }); let n = 0;
  f.model = call => {
    if (call.url.endsWith(':batchEmbedContents')) return { body: { embeddings: call.body.requests.map(() => ({ values: unitVector() })) } };
    const schema = call.body?.generationConfig?.responseSchema?.properties;
    const input = call.body?.contents ? JSON.parse(call.body.contents[0].parts[0].text) : {}; let value;
    if (schema?.guideRequirements) value = { guideRequirements: quotes };
    if (schema?.journeyComparisons) value = {
      journeyComparisons: input.requirements.map(r => ({ requirementId: r.id, evidence: r.quote.includes('SQL') || !r.allowedEvidenceIds.length ? [] : [{ id: r.allowedEvidenceIds[0], quote: '使用 Python 開發 API 工具' }] })),
      journeyQuestions: ['請說明你獨立負責的部分？', '請說明如何驗證實際成果？', '請舉例說明如何處理困難？'].map((text, i) => ({ requirementId: input.requirements[i % input.requirements.length].id, text }))
    };
    if (schema?.journeyFollowups) value = { journeyFollowups: input.interview.map((q, i) => ({ requirementId: q.requirementId, text: '你補充「' + q.answer.slice(0, 60) + '」，請說明驗證方式 ' + (i + 1) + '？' })) };
    return { body: value ? { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] } : {} };
  };
  f.state.response = call => f.model(call); f.gas.syncKnowledgeBase(); f.state.calls.length = 0;
  f.step = (text, user = 'hr', id) => { const e = event(text, id || 'journey-' + ++n); e.source.userId = user;
    if (/^(jg|jm):/.test(text)) { e.type = 'postback'; e.postback = { data: text }; }
    return f.gas.handleJobGuide_(e, text, f.gas.config_()); };
  f.read = (user = 'hr') => f.gas.guideRead_(user, f.gas.config_());
  f.begin = () => { f.step('jg:start'); f.step(job); return f.read(); };
  f.analyze = () => { const s = f.begin(); f.step('jg:compare:' + s.id); return f.read(); };
  f.finalize = () => { const s = f.read(); return f.step('jg:finalize:' + s.id + ':' + f.gas.journeyToken_(s)); };
  f.finish = () => { f.analyze(); f.step('我負責 API 串接'); f.step('我使用測試驗證'); f.step('我排查錯誤'); f.finalize(); return f.read(); };
  return f;
}
for (const mode of [undefined, 'bundle']) test('one job, batch evidence, three answers and confirmed followups: ' + (mode || 'sources'), () => {
  const f = fixture(mode), review = f.begin(), id = review.id;
  assert.deepEqual([...review.requirements.map(r => r.kind)], ['未指定', '必要', '加分']);
  assert.match(output(f.step('jg:compare:' + id)), /AI 訪談 1 \/ 3/);
  assert.equal(f.read().id, id); assert.equal(f.read().interview.questions.length, 3);
  assert.equal(f.state.calls.filter(c => c.url.endsWith(':batchEmbedContents')).length, 1); assert(!f.gas.ownerLineUserId_());
  assert.match(output(f.step('我的工作內容')), /AI 訪談 2 \/ 3/);
  f.step('我的驗證方式'); assert.match(output(f.step('我的排錯方法')), /確認三題回答/);
  assert.equal(f.read().stage, 'reviewAnswers'); assert.match(output(f.finalize()), /5 \/ 5 整合結果/);
  assert.equal(f.read().id, id); assert.equal(f.read().interview.followups.length, 3);
  const report = f.step('jg:report:' + id), text = output(report);
  assert.match(text, /使用 Python 開發 API 工具/); assert.match(text, /來源：專案：資料工具/);
  assert.match(text, /本次對話填寫者補充（未驗證本人）/); assert.match(text, /我的驗證方式/);
  assert.match(text, /正式面試追問/); assert.match(text, /不代表不具備能力/);
  assert(report.length <= 5); report.forEach(m => { assert(m.text.length <= 4500); assert(!m.quickReply || m.quickReply.items.length > 0); });
  assert.equal(f.state.documentWrites, 0); assert(!f.state.calls.some(c => c.url.endsWith('/push')));
});
test('answer replay, old skip, pause and editing preserve the same job and unaffected answers', () => {
  const f = fixture(), s = f.analyze(), oldToken = f.gas.journeyToken_(s);
  f.step('第一題回答', 'hr', 'answer-once'); f.step('第一題回答', 'hr', 'answer-once'); assert.equal(f.read().interview.cursor, 1);
  f.step('jg:skip:' + s.id + ':' + oldToken); assert.equal(f.read().interview.cursor, 1);
  f.step('jg:leave:' + s.id); assert.equal(f.step('一般履歷問題'), null);
  assert.match(output(f.step('jg:resume')), /AI 訪談 2 \/ 3/); assert.equal(f.read().id, s.id);
  f.step('略過'); f.step('第三題回答'); assert.equal(f.read().stage, 'reviewAnswers');
  const q = f.read().interview.questions[1]; f.step('jg:edit:' + s.id + ':' + q.id); assert.equal(f.read().interview.cursor, 1);
  f.step('補上第二題'); assert.equal(f.read().interview.answers[0], '第一題回答'); assert.equal(f.read().interview.answers[2], '第三題回答');
  f.finalize(); assert.equal(f.read().stage, 'complete');
});
test('start preserves an upload; replacement and deletion require explicit confirmation', () => {
  const f = fixture(); f.step('jg:start'); assert.match(output(f.step('AI工程師')), /完整職缺/); f.step(job); const s = f.read();
  assert.match(output(f.step('jg:start')), /已有這份職缺/); assert.equal(f.read().id, s.id);
  f.step('jg:job:' + s.id); f.step(job + '\n其他條件：具備溝通能力');
  assert.equal(f.read().job, job); assert.match(output(f.step('jg:resume')), /確認更換職缺/);
  f.step('jg:keep:' + s.id); assert.equal(f.read().job, job);
  f.step('jg:job:' + s.id); f.step(job); const token = f.gas.sha256_(f.read().pendingJob).slice(0, 12);
  f.step('jg:replace:' + s.id + ':' + token); assert.notEqual(f.read().id, s.id);
  assert.match(output(f.step('jg:compare:' + s.id)), /舊職缺/);
  const current = f.read(); f.step('取消'); assert(f.read()); f.step('jg:delete:' + current.id); assert(f.read());
  f.step('jg:deleteyes:' + current.id); assert.equal(f.read(), null);
});
test('invalid quotes, quota and malformed followups fail without losing saved answers', () => {
  const f = fixture(), original = f.model, review = f.begin();
  f.model = call => { const response = original(call);
    if (call.body?.generationConfig?.responseSchema?.properties?.journeyComparisons) { const value = JSON.parse(response.body.candidates[0].content.parts[0].text); value.journeyComparisons[0].evidence[0].id = 'unknown'; response.body.candidates[0].content.parts[0].text = JSON.stringify(value); }
    return response; };
  assert.match(output(f.step('jg:compare:' + review.id)), /引用未通過核對/); assert.equal(f.read().stage, 'review');
  f.model = call => call.url.endsWith(':batchEmbedContents') ? { status: 429 } : original(call);
  assert.match(output(f.step('jg:compare:' + review.id)), /429/); assert.equal(Object.keys(f.read().results).length, 0);
  f.model = original; f.step('jg:compare:' + review.id); f.step('回答一'); f.step('回答二'); f.step('回答三');
  f.model = call => call.body?.generationConfig?.responseSchema?.properties?.journeyFollowups ? { body: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"journeyFollowups":[]}' }] } }] } } : original(call);
  assert.match(output(f.finalize()), /格式或引用未通過核對/); assert.equal(f.read().stage, 'reviewAnswers'); assert.equal(f.read().interview.answers[2], '回答三');
  f.model = original; f.finalize(); assert.equal(f.read().stage, 'complete');
});
test('source changes stop stale evidence and reanalysis preserves previous answers separately', () => {
  const f = fixture(), s = f.finish(); f.state.text = source.replace('負責錯誤處理', '協助錯誤處理');
  const stale = output(f.step('jg:resume')); assert.match(stale, /履歷來源已更動/); assert(!stale.includes('使用 Python 開發 API 工具'));
  assert.match(output(f.step('jg:answers:' + s.id)), /我負責 API 串接/);
  f.gas.syncKnowledgeBase(); f.step('jg:compare:' + s.id); assert.equal(f.read().stage, 'interview'); assert.equal(f.read().interview.answers[0], null);
  assert.match(output(f.step('jg:previous:' + s.id)), /我負責 API 串接/);
  const g = fixture(), pending = g.begin(), original = g.model;
  g.model = call => { const result = original(call); if (call.body?.generationConfig?.responseSchema?.properties?.journeyComparisons) g.state.text = source.replace('Python', 'JavaScript'); return result; };
  assert.match(output(g.step('jg:compare:' + pending.id)), /履歷來源已更動/); assert(!g.read().interview);
});
test('old role links resume the uploaded job; legacy imports enforce ownership and preserve old records', () => {
  const f = fixture(), s = f.analyze(); assert.match(output(f.step('待回答職缺')), /同一份職缺/); assert.equal(f.read().id, s.id);
  assert.match(output(f.step('jm:role:applicant')), /AI 訪談 1 \/ 3/); assert.match(output(f.step('jg:resume', 'other')), /沒有有效職缺/);
  const cfg = f.gas.config_(), id = 'a'.repeat(16);
  f.gas.updatePortfolioStore_(cfg, store => { store.jobMatch = { records: { [id]: { id, job, expiresAt: Date.now() + 600000, visitor: f.gas.invitationVisitor_('hr') } }, drafts: {} }; });
  assert.match(output(f.step('jg:import:' + id, 'other')), /找不到可沿用/); f.step('jg:import:' + id); assert(f.read().pendingJob);
  assert(f.gas.loadPortfolioStore_(cfg).jobMatch.records[id]);
});
test('busy requests do not duplicate AI and slow results cannot overwrite replacement state', () => {
  const f = fixture(), s = f.begin(), original = f.model; let changed = false;
  f.model = call => { if (call.body?.generationConfig?.responseSchema?.properties?.journeyComparisons && !changed) { changed = true; assert.match(output(f.step('jg:resume')), /正在整理/); f.step('jg:job:' + s.id); } return original(call); };
  assert.match(output(f.step('jg:compare:' + s.id)), /未使用舊請求/); assert.equal(f.read().awaitingReplacement, true); assert(!f.read().interview);
});
test('existing v5 jobs continue without another extraction or role-specific store', () => {
  const f = fixture(), cfg = f.gas.config_(), id = 'c'.repeat(16);
  f.gas.updatePortfolioStore_(cfg, store => { store.jobGuides = { [f.gas.guideActor_('hr', cfg)]: { id, job, stage: 'analysis', results: {},
    requirements: quotes.map(q => ({ id: f.gas.sha256_(q).slice(0, 12), quote: q, kind: '未指定' })), fingerprint: f.gas.loadIndex_(cfg).fingerprint,
    expiresAt: Date.now() + 600000, updatedAt: Date.now() } }; });
  assert.match(output(f.step('待回答職缺')), /三題訪談/); f.step('jg:compare:' + id);
  assert.equal(f.read().id, id); assert.equal(f.read().stage, 'interview'); assert.equal(f.state.calls.filter(c => c.body?.generationConfig?.responseSchema?.properties?.guideRequirements).length, 0);
});
for (const mode of [undefined, 'bundle']) test('result-to-invitation keeps confirmation and webhook no longer switches roles: ' + (mode || 'sources'), () => {
  const f = fixture(mode), s = f.finish(); let n = 0;
  const send = text => { const e = event(text, 'web-' + ++n); e.source.userId = 'hr'; f.gas.handleEvent_(e, f.gas.config_()); return f.state.calls.filter(c => c.url.endsWith('/message/reply')).at(-1).body.messages; };
  const home = send('首頁')[0]; assert.deepEqual([...home.contents.contents[0].footer.contents.map(b => b.action.label)], ['看履歷', '貼職缺', '聯繫邀約']);
  assert.match(output(send('模擬人資')), /不需要角色切換/); assert.equal(f.read().id, s.id);
  assert.match(output(f.step('jg:invite:' + s.id)), /公司／單位與您的稱呼/); send('測試公司');
  assert.equal(f.gas.invitationDraft_(f.gas.invitationKey_('hr', f.gas.config_())).step, 2);
  f.step('jg:invite:' + s.id); assert.equal(f.gas.invitationDraft_(f.gas.invitationKey_('hr', f.gas.config_())).step, 2);
  assert(!f.state.calls.some(c => c.url.endsWith('/push')));
});
test('only approved cited work previews appear; expiry intercepts leftover private answers', () => {
  const f = fixture(), s = f.finish(); f.gas.portfolioEntries_ = () => [
    { title: '專案：資料工具', imageKey: 'a'.repeat(64), imageUrl: 'https://example.test/image.png', viewUrl: 'https://example.test/work', width: 300, height: 300 },
    { title: '無關作品', imageKey: 'b'.repeat(64), imageUrl: 'https://example.test/other.png', viewUrl: 'https://example.test/other', width: 300, height: 300 }];
  const card = f.step('jg:evidence:' + s.id).find(m => m.type === 'flex'); assert.equal(card.contents.contents.length, 1); assert(!JSON.stringify(card).includes('無關作品'));
  f.gas.updatePortfolioStore_(f.gas.config_(), store => { Object.values(store.jobGuides).forEach(row => { row.expiresAt = 1; }); });
  assert.match(output(f.step('剩下的私密回答')), /已過期/); assert.equal(f.read(), null);
});

test('three AI questions are mandatory even for one requirement, malformed counts do not use fixed fallback questions', () => {
  const f = fixture(), original = f.model; let invalid = true;
  f.model = call => {
    const response = original(call), schema = call.body?.generationConfig?.responseSchema?.properties;
    if (schema?.guideRequirements) response.body.candidates[0].content.parts[0].text = JSON.stringify({ guideRequirements: [quotes[0]] });
    if (schema?.journeyComparisons && invalid) { const value = JSON.parse(response.body.candidates[0].content.parts[0].text); value.journeyQuestions.pop(); response.body.candidates[0].content.parts[0].text = JSON.stringify(value); }
    return response;
  };
  const s = f.begin(); assert.match(output(f.step('jg:compare:' + s.id)), /格式或引用未通過核對/); assert(!f.read().interview);
  invalid = false; f.step('jg:compare:' + s.id); assert.equal(f.read().interview.questions.length, 3);
  assert.equal(f.read().requirements.length, 1);
});

test('legacy resume unpauses the current interview, oversized answers and premature finalize cannot bypass steps', () => {
  const f = fixture(), s = f.analyze(); f.step('首頁');
  assert.match(output(f.step('待回答職缺')), /AI 訪談 1 \/ 3/); assert.equal(f.read().paused, false);
  assert.match(output(f.step('x'.repeat(801))), /最多 800/); assert.equal(f.read().interview.answers[0], null);
  const before = f.state.calls.filter(c => c.body?.generationConfig?.responseSchema?.properties?.journeyFollowups).length;
  f.finalize(); assert.equal(f.read().stage, 'interview');
  assert.equal(f.state.calls.filter(c => c.body?.generationConfig?.responseSchema?.properties?.journeyFollowups).length, before);
  f.step('第一題'); assert.equal(f.read().interview.cursor, 1); assert.equal(f.read().id, s.id);
});

test('confirmed owner label is separate from unverified content and finalization or compare replay does not regenerate', () => {
  const f = fixture(), owner = 'U' + '1'.repeat(32); f.state.properties.set('OWNER_LINE_USER_ID', owner);
  f.step('jg:start', owner); f.step(job, owner); const s = f.read(owner); f.step('jg:compare:' + s.id, owner);
  assert.equal(f.read(owner).interview.origin, '已設定的履歷本人帳號補充');
  f.step('一號回答', owner); f.step('二號回答', owner); f.step('三號回答', owner);
  const token = f.gas.journeyToken_(f.read(owner)); f.step('jg:finalize:' + s.id + ':' + token, owner);
  const calls = () => f.state.calls.filter(c => c.url.includes('generativelanguage')).length, before = calls();
  f.step('jg:finalize:' + s.id + ':' + token, owner); f.step('jg:compare:' + s.id, owner);
  assert.equal(calls(), before); assert.match(output(f.step('jg:answers:' + s.id, owner)), /尚未查證/);
});
