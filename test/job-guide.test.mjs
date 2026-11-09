import test from 'node:test';
import assert from 'node:assert/strict';
import { createGas, event, unitVector } from './harness.mjs';

const job = '職缺：AI工程師\n工作內容：使用 Python 開發應用與串接 API\n必要條件：具備 Python 專案經驗\n加分條件：使用過 SQL';
const requirements = ['使用 Python 開發應用與串接 API', '具備 Python 專案經驗', '使用過 SQL'];
const text = '[[PUBLIC]]\n## 專案：資料工具\n使用 Python 開發 API 工具，負責錯誤處理。\n[[/PUBLIC]]';
const output = messages => messages.map(m => m.text || m.altText).join('\n');
function fixture(sourceMode) {
  const f = createGas({ text, sourceMode }); let n = 0;
  f.model = call => {
    if (call.url.endsWith(':batchEmbedContents')) return { body: { embeddings: call.body.requests.map(() => ({ values: unitVector() })) } };
    if (call.url.endsWith(':embedContent')) return { body: { embedding: { values: unitVector() } } };
    const schema = call.body?.generationConfig?.responseSchema?.properties;
    let value;
    if (schema?.guideRequirements) value = { guideRequirements: requirements };
    if (schema?.guideEvidence) {
      const input = JSON.parse(call.body.contents[0].parts[0].text);
      value = { guideEvidence: input.requirement.includes('SQL') ? [] : [{ id: input.evidence[0].id, quote: '使用 Python 開發 API 工具' }],
        followup: '請說明一項你獨立負責的工作，以及如何驗證結果？' };
    }
    return { body: value ? { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] } : {} };
  };
  f.state.response = call => f.model(call);
  f.gas.syncKnowledgeBase(); f.state.calls.length = 0;
  f.step = (value, user = 'hr', eventId) => {
    const e = event(value, eventId || 'guide-' + ++n); e.source.userId = user;
    if (value.startsWith('jg:')) { e.type = 'postback'; e.postback = { data: value }; }
    return f.gas.handleJobGuide_(e, value, f.gas.config_());
  };
  f.read = (user = 'hr') => f.gas.guideRead_(user, f.gas.config_());
  f.begin = () => { f.step('jg:start'); f.step(job); return f.read(); };
  f.finish = () => {
    let s = f.begin(); f.step('jg:compare:' + s.id);
    s = f.read(); for (const r of s.requirements) f.step('jg:next:' + s.id + ':' + r.id);
    return f.read();
  };
  return f;
}

for (const mode of [undefined, 'bundle']) test('job evidence guide and copyable preparation sheet without owner setup: ' + (mode || 'sources'), () => {
  const f = fixture(mode); assert(!f.gas.ownerLineUserId_());
  const s = f.finish();
  assert.equal(s.requirements.length, 3); assert.equal(Object.keys(s.results).length, 3);
  assert.deepEqual([...s.requirements.map(r => r.kind)], ['未指定', '必要', '加分']);
  const report = f.step('jg:report:' + s.id), message = output(report);
  assert.match(message, /使用 Python 開發 API 工具/); assert.match(message, /來源：專案：資料工具/);
  assert.match(message, /本次檢索未找到可核對引用/); assert.match(message, /不代表本人不具備/);
  assert.match(message, /面談追問/); assert.match(message, /長按複製/);
  assert(report.length <= 5);
  report.forEach(m => { assert(m.text.length <= 4500); assert(!m.quickReply || m.quickReply.items.length > 0); });
  assert.equal(f.state.documentWrites, 0);
  assert(!f.state.calls.some(c => c.url.endsWith('/push')));
  const jobCalls = f.state.calls.filter(c => c.body?.generationConfig?.responseSchema?.properties?.guideRequirements);
  assert.equal(jobCalls.length, 1);
  const before = f.state.calls.length;
  f.step('jg:next:' + s.id + ':' + s.requirements[0].id);
  assert.equal(f.state.calls.length, before, 'repeated old next button does not run another analysis');
});

test('short title is not accepted as a full job; replacing job is allowed without cancelling', () => {
  const f = fixture(); f.step('jg:start');
  assert.match(output(f.step('AI工程師')), /補上工作內容/); assert.equal(f.read().stage, 'input');
  f.step(job); const old = f.read().id;
  assert.match(output(f.step(job)), /職缺條件確認/); const current = f.read().id;
  assert.notEqual(old, current);
  assert.match(output(f.step('jg:compare:' + old)), /舊職缺已失效/);
  const s = f.read(); f.step('jg:remove:' + s.id + ':' + s.requirements[1].id);
  assert.equal(f.read().requirements.length, 2);
});

test('invented requirement and evidence quotes fail closed, while API quota is distinct from missing evidence', () => {
  const f = fixture(), original = f.model;
  f.model = call => call.body?.generationConfig?.responseSchema?.properties?.guideRequirements ?
    { body: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ guideRequirements: ['主管經驗十年'] }) }] } }] } } : original(call);
  f.step('jg:start'); assert.match(output(f.step(job)), /引用未通過核對/);
  assert.equal(f.read().stage, 'extract');
  f.model = original; f.step('jg:extract:' + f.read().id); const s = f.read();
  f.model = call => call.body?.generationConfig?.responseSchema?.properties?.guideEvidence ?
    { body: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ guideEvidence: [{ id: 'unknown', quote: '憑空編造的經驗' }], followup: '怎麼完成？' }) }] } }] } } : original(call);
  assert.match(output(f.step('jg:compare:' + s.id)), /引用未通過核對/);
  assert.equal(Object.keys(f.read().results).length, 0);
  f.model = call => call.url.endsWith(':embedContent') ? { status: 429 } : original(call);
  assert.match(output(f.step('jg:next:' + s.id + ':' + s.requirements[0].id)), /429/);
  assert.equal(Object.keys(f.read().results).length, 0);
});

test('source changes prevent stale reports and changes during analysis discard generated evidence', () => {
  const f = fixture(), s = f.finish(); f.state.text = text.replace('負責錯誤處理', '尚未負責錯誤處理');
  const response = output(f.step('jg:report:' + s.id));
  assert.match(response, /履歷來源已更動/); assert(!response.includes('使用 Python 開發 API 工具'));
  assert.match(output(f.step('jg:works:' + s.id)), /履歷來源已更動/);
  const g = fixture(), pending = g.begin(), original = g.model;
  g.model = call => { const response = original(call); if (call.body?.generationConfig?.responseSchema?.properties?.guideEvidence) g.state.text += '\n[[PUBLIC]]\nchanged\n[[/PUBLIC]]'; return response; };
  assert.match(output(g.step('jg:compare:' + pending.id)), /履歷來源已更動/);
  assert.equal(Object.keys(g.read().results).length, 0);
});

test('visitor isolation, cancellation, expiry and navigation prevent private data from reaching normal RAG', () => {
  const f = fixture(), s = f.finish();
  assert.match(output(f.step('jg:report:' + s.id, 'other')), /沒有有效準備單/);
  f.step('首頁'); assert.equal(f.step('一般履歷問題'), null);
  f.step('面談準備單'); f.step('取消'); assert.equal(f.read(), null);
  f.begin(); f.gas.updatePortfolioStore_(f.gas.config_(), store => {
    Object.values(store.jobGuides).forEach(row => { row.expiresAt = 1; });
  });
  assert.match(output(f.step('私人的職缺輸入')), /已過期/); assert.equal(f.read(), null);
});

test('work guide includes only approved previews tied to exact cited source and does not publish assets', () => {
  const f = fixture(), s = f.finish();
  const entries = [{ title: f.gas.portfolioTitle_('專案：資料工具'), section: '專案：資料工具', imageKey: 'a'.repeat(64), text: '畫面', imageUrl: 'https://example.test/image.png', viewUrl: 'https://example.test/work', width: 300, height: 300 },
    { title: '無關作品', section: '無關作品', imageKey: 'b'.repeat(64), text: '無關', imageUrl: 'https://example.test/other.png', viewUrl: 'https://example.test/other', width: 300, height: 300 }];
  f.gas.portfolioEntries_ = () => entries;
  const result = f.step('jg:works:' + s.id);
  assert.equal(result[1].contents.contents.length, 1);
  assert.match(JSON.stringify(result[1]), /資料工具/); assert(!JSON.stringify(result[1]).includes('無關作品'));
  f.gas.portfolioEntries_ = () => [];
  assert.match(output(f.step('jg:works:' + s.id)), /未對應到已開放/);
});

test('slow extraction cannot overwrite a newly pasted job and busy state avoids duplicate AI calls', () => {
  const f = fixture(), original = f.model; let replaced = false;
  f.model = call => {
    if (call.body?.generationConfig?.responseSchema?.properties?.guideRequirements && !replaced) {
      replaced = true; assert.match(output(f.step('jg:extract:' + f.read().id)), /正在處理/);
      f.step('jg:job:' + f.read().id);
    }
    return original(call);
  };
  f.step('jg:start'); assert.match(output(f.step(job)), /職缺已變更/);
  assert.equal(f.read().stage, 'input');
});

test('webhook exposes the primary flow to the owner without switching or notification configuration', () => {
  for (const mode of [undefined, 'bundle']) {
    const f = fixture(mode); let n = 0;
    function send(value) {
      const e = event(value, 'web-guide-' + ++n);
      if (value.startsWith('jg:')) { e.type = 'postback'; e.postback = { data: value }; }
      f.gas.handleEvent_(e, f.gas.config_());
      return f.state.calls.filter(c => c.url.endsWith('/message/reply')).at(-1).body.messages;
    }
    const home = send('首頁')[0];
    assert(home.contents.contents[0].footer.contents.some(b => b.action.data === 'jg:start'));
    assert.deepEqual([...home.contents.contents[0].footer.contents.map(b => b.action.label)], ['看履歷', '貼職缺', '聯繫邀約']);
    assert.match(output(send('jg:start')), /不需要角色切換/);
    assert.match(output(send(job)), /職缺條件確認/);
    const s = f.gas.guideRead_('user-1', f.gas.config_());
    assert.equal(s.stage, 'review'); assert.equal(f.state.documentWrites, 0);
    send('首頁'); send('留下邀約');
    assert.match(output(send('jg:start')), /先完成或取消邀約/);
  }
});

test('no retrieval hits is a genuine missing-evidence result without a generation call', () => {
  const f = fixture(), s = f.begin(), original = f.model;
  f.model = call => call.url.endsWith(':embedContent') ? { body: { embedding: { values: unitVector(1) } } } : original(call);
  const before = f.state.calls.length;
  f.step('jg:compare:' + s.id);
  const result = f.read().results[s.requirements[0].id];
  assert.equal(result.evidence.length, 0);
  assert(!f.state.calls.slice(before).some(c => c.body?.generationConfig?.responseSchema?.properties?.guideEvidence));
});

test('replayed input and confirm events do not repeat extraction or advance another requirement', () => {
  const f = fixture(); f.step('jg:start'); f.step(job, 'hr', 'input-once');
  const s = f.read(), before = f.state.calls.length;
  f.step(job, 'hr', 'input-once');
  assert.equal(f.read().id, s.id); assert.equal(f.state.calls.length, before);
  f.step('jg:compare:' + s.id); const afterFirst = f.state.calls.length;
  f.step('jg:compare:' + s.id);
  assert.equal(f.state.calls.length, afterFirst); assert.equal(Object.keys(f.read().results).length, 1);
  f.step('jg:job:' + s.id);
  assert.match(output(f.step(job, 'hr', 'input-once')), /未覆蓋目前內容/);
  assert.equal(f.read().stage, 'input');
});

for (const mode of [undefined, 'bundle']) test('summary first with evidence details and invitation handoff: ' + (mode || 'sources'), () => {
  const f = fixture(mode), s = f.finish();
  const summary = f.step('jg:resume');
  assert.equal(summary.length, 1); assert.match(output(summary), /職缺重點摘要/);
  assert.match(output(summary), /有相關原文 2 項／待確認 1 項／尚未比對 0 項/);
  assert(!output(summary).includes('面談追問：'));
  assert(summary[0].quickReply.items.some(item => item.action.data === 'jg:invite:' + s.id));
  assert.match(output(f.step('jg:report:' + s.id)), /面談追問：/);
  assert.match(output(f.step('jg:invite:' + s.id, 'other')), /沒有有效準備單/);
  assert.match(output(f.step('jg:invite:' + s.id)), /公司／單位與您的稱呼/);
  assert.equal(f.read().paused, true);
  assert(!f.state.calls.some(call => call.url.endsWith('/push')));
  const e = event('測試公司，王小姐', 'handoff-company'); e.source.userId = 'hr';
  f.gas.handleEvent_(e, f.gas.config_());
  const key = f.gas.invitationKey_('hr', f.gas.config_());
  assert.equal(f.gas.invitationDraft_(key).fields.company, '測試公司，王小姐');
  f.step('jg:invite:' + s.id);
  assert.equal(f.gas.invitationDraft_(key).step, 1, 'reopening invitation must preserve already entered fields');
});

test('summary revalidates source and other operations can delete stale preparation sheets', () => {
  const f = fixture(), s = f.finish();
  f.state.text = text.replace('Python', 'JavaScript');
  assert.match(output(f.step('jg:summary:' + s.id)), /履歷來源已更動/);
  assert.match(output(f.step('jg:next:' + s.id + ':' + s.requirements[0].id)), /履歷來源已更動/);
  assert.match(output(f.step('jg:options:' + s.id)), /其他操作/);
  assert.match(output(f.step('jg:delete:' + s.id)), /已刪除/); assert.equal(f.read(), null);
});

test('primary text labels route consistently with buttons and advanced features stay in more menu', () => {
  const f = fixture(); let n = 0;
  function send(text) {
    const e = event(text, 'main-label-' + ++n); e.source.userId = 'hr';
    f.gas.handleEvent_(e, f.gas.config_());
    return f.state.calls.filter(c => c.url.endsWith('/message/reply')).at(-1).body.messages;
  }
  assert.match(output(send('貼職缺')), /第 1 步/);
  assert.match(output(send('更多功能')), /更多功能/);
  const more = send('更多功能')[0];
  assert(more.quickReply.items.some(item => item.action.data === 'jm:menu'));
  assert.match(output(send('聯繫邀約')), /聯繫本人/);
  f.gas.answerLineConversation_ = function (question, cfg, original, user, focus, gallery, topicId) {
    assert.equal(topicId, f.gas.visibleMenuTopics_()[1].id);
    return { messages: [{ type: 'text', text: '履歷概覽' }] };
  };
  assert.match(output(send('看履歷')), /履歷概覽/);
});
