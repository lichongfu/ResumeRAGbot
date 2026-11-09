import test from 'node:test';
import assert from 'node:assert/strict';
import { createGas, event } from './harness.mjs';

const owner = 'U' + '1'.repeat(32);
function fixture(mode) {
  const f = createGas({ sourceMode: mode, properties: { OWNER_LINE_USER_ID: owner } });
  let n = 0;
  f.step = (user, text, id) => {
    const e = event(text, id || 'job-' + ++n); e.source.userId = user;
    if (text.startsWith('jm:')) { e.type = 'postback'; e.postback = { data: text }; }
    return f.gas.handleJobMatch_(e, text, f.gas.config_());
  };
  f.records = () => f.gas.loadPortfolioStore_(f.gas.config_()).jobMatch.records;
  f.submit = (user = 'hr') => {
    f.step(user, '職缺對照'); f.step(user, '資料分析助理\n必要：Python\n加分：SQL');
    f.step(user, '必要：Python');
    const draft = f.gas.loadPortfolioStore_(f.gas.config_()).jobMatch.drafts[f.gas.invitationVisitor_(user)];
    f.step(user, 'jm:submit:' + draft.id); return draft.id;
  };
  return f;
}
const output = messages => messages.map(m => m.text).join('\n');

for (const mode of [undefined, 'bundle']) test('owner can test both roles with isolated data and explicit sharing: ' + (mode || 'sources'), () => {
  const f = fixture(mode), cfg = f.gas.config_();
  const labels = user => f.gas.jobInterviewActions_(user, cfg).map(b => b.action.data);
  assert(labels(owner).includes('jm:role:recruiter'));
  assert(!labels(owner).includes('jm:start'));
  assert(!labels('hr').some(x => x.startsWith('jm:role:')));
  assert.match(output(f.step('hr', 'jm:role:recruiter')), /僅限/);
  assert.match(output(f.step(owner, '模擬人資')), /目前角色：人資/);
  assert(labels(owner).includes('jm:start'));
  assert(!labels(owner).includes('jm:role:recruiter'));
  f.step(owner, '職缺對照'); f.step(owner, 'Python 開發'); f.step(owner, 'Python');
  const virtual = f.gas.invitationVisitor_(owner + ':job-test:' + cfg.docId);
  const draft = f.gas.loadPortfolioStore_(cfg).jobMatch.drafts[virtual], id = draft.id;
  f.step(owner, 'jm:submit:' + id);
  assert(f.records()[id].testOwner);
  assert.match(output(f.step(owner, 'jm:answer:' + id)), /僅限/);
  f.step(owner, '切回應徵者');
  assert(!labels(owner).includes('jm:start'));
  f.step(owner, 'jm:answer:' + id); f.step(owner, '我的 Python 作品');
  f.step(owner, '模擬人資');
  assert.equal(f.records()[id].status, 'paused');
  assert(!output(f.step(owner, 'jm:view:' + id)).includes('我的 Python 作品'));
  f.step(owner, '切回應徵者'); f.step(owner, 'jm:answer:' + id);
  assert.equal(f.records()[id].answers.length, 1);
  f.step(owner, '處理方式'); f.step(owner, '工作期待'); f.step(owner, 'jm:share:' + id);
  f.step(owner, '模擬人資');
  assert.match(output(f.step(owner, 'jm:view:' + id)), /我的 Python 作品/);
  assert.match(output(f.step('other', 'jm:view:' + id)), /找不到/);
  f.step(owner, '結束測試');
  assert(!output(f.step(owner, '待回答職缺')).includes(id));
  assert.equal(f.gas.jobRoleState_(owner, cfg).testing, undefined);
});

test('test recruiter cannot see real requests and expired roles do not send input into RAG', () => {
  const f = fixture(), real = f.submit('real-hr'), cfg = f.gas.config_();
  f.step(owner, '模擬人資');
  assert.match(output(f.step(owner, 'jm:view:' + real)), /找不到/);
  const key = f.gas.jobRoleKey_(cfg), state = JSON.parse(f.state.properties.get(key));
  state.expiresAt = 1; f.state.properties.set(key, JSON.stringify(state));
  assert.match(output(f.step(owner, '私人的未完成回答')), /測試已過期/);
  assert.equal(f.state.properties.has(key), false);
  assert(!f.state.calls.some(c => c.url.includes('generativelanguage')));
  const view = f.step(owner, 'jm:view:' + real);
  assert(view[0].quickReply.items.some(item => item.action.data === 'jm:answer:' + real));
});

test('role switches preserve the test recruiter draft and cannot be triggered by unrelated text', () => {
  const f = fixture(), cfg = f.gas.config_();
  assert.equal(f.step('hr', 'toString'), null);
  f.step(owner, '模擬人資'); f.step(owner, '職缺對照'); f.step(owner, 'Python 開發');
  const virtual = f.gas.invitationVisitor_(owner + ':job-test:' + cfg.docId);
  const id = f.gas.loadPortfolioStore_(cfg).jobMatch.drafts[virtual].id;
  f.step(owner, '切回應徵者'); f.step(owner, '模擬人資'); f.step(owner, 'Python');
  f.step(owner, 'jm:submit:' + id);
  assert.equal(f.records()[id].focus, 'Python');
  assert(f.records()[id].testOwner);
});

test('home uses sender role and active invitation prevents switching roles', () => {
  const f = fixture(), cfg = f.gas.config_(); let n = 0;
  function send(text) { const e = event(text, 'role-web-' + ++n); e.source.userId = owner; f.gas.handleEvent_(e, cfg); }
  send('首頁');
  let home = f.state.calls.filter(c => c.url.endsWith('/message/reply')).at(-1).body.messages[0];
  let buttons = home.contents.contents[2].footer.contents.map(b => b.action.data);
  assert(!buttons.includes('jm:start')); assert(buttons.includes('jg:more'));
  assert(home.contents.contents[0].footer.contents.some(b => b.action.data === 'jg:start'));
  send('模擬人資'); send('首頁');
  home = f.state.calls.filter(c => c.url.endsWith('/message/reply')).at(-1).body.messages[0];
  buttons = home.contents.contents[2].footer.contents.map(b => b.action.data);
  assert(buttons.includes('jg:more'));
  assert(home.contents.contents[0].footer.contents.some(b => b.action.data === 'jg:start'));
  send('jm:menu');
  const menu = f.state.calls.filter(c => c.url.endsWith('/message/reply')).at(-1).body.messages[0];
  assert(menu.quickReply.items.some(item => item.action.data === 'jm:role:applicant'));
  send('留下邀約'); send('結束測試');
  const reply = f.state.calls.filter(c => c.url.endsWith('/message/reply')).at(-1).body.messages[0];
  assert.match(reply.text, /先完成或取消/);
  assert.equal(f.gas.jobRoleState_(owner, cfg).role, 'recruiter');
});

test('postback entry sends a valid LINE reply without an empty quickReply array', () => {
  for (const mode of [undefined, 'bundle']) {
    const f = fixture(mode), e = event('', 'postback-entry');
    e.source.userId = 'hr'; e.type = 'postback'; e.postback = { data: 'jm:start' };
    f.state.response = call => {
      if (call.url.endsWith('/message/reply')) {
        for (const message of call.body.messages) {
          assert(!message.quickReply || message.quickReply.items.length > 0,
            'LINE rejects a present quickReply with zero items');
        }
      }
      return { body: {} };
    };
    assert.equal(f.gas.handleEvent_(e, f.gas.config_()), 'replied');
    const reply = f.state.calls.find(c => c.url.endsWith('/message/reply'));
    assert.match(reply.body.messages[0].text, /請貼上職缺文字/);
    assert(!('quickReply' in reply.body.messages[0]));
    const withActions = f.gas.jobMessage_('test', [['取消', 'jm:cancel-draft']]);
    assert.equal(withActions[0].quickReply.items.length, 1);
  }
});

for (const mode of [undefined, 'bundle']) test('private three-question workflow with explicit sharing: ' + (mode || 'sources'), () => {
  const f = fixture(mode), id = f.submit();
  assert.equal(f.records()[id].status, 'waiting');
  assert.equal(f.state.calls.filter(c => c.url.endsWith('/push')).length, 1);
  assert.match(output(f.step('other-hr', 'jm:view:' + id)), /找不到/);
  assert.match(output(f.step('hr', 'jm:answer:' + id)), /僅限/);
  assert.match(output(f.step(owner, 'jm:answer:' + id)), /第 1 \/ 3/);
  assert.match(output(f.step(owner, '我負責清理資料', 'same-answer')), /第 2 \/ 3/);
  assert.match(output(f.step(owner, '我負責清理資料', 'same-answer')), /第 2 \/ 3/);
  assert.equal(f.records()[id].answers.length, 1);
  f.step(owner, '使用檢查表核對結果');
  assert.match(output(f.step(owner, '希望有人協助熟悉業務', 'final-answer')), /分享前確認/);
  assert.match(output(f.step(owner, '希望有人協助熟悉業務', 'final-answer')), /分享前確認/);
  assert.match(output(f.step(owner, '我還想修改')), /分享前確認/);
  assert.equal(f.records()[id].answers.length, 3);
  assert(!output(f.step('hr', 'jm:view:' + id)).includes('我負責清理資料'));
  f.step(owner, 'jm:share:' + id);
  const result = output(f.step('hr', 'jm:view:' + id));
  assert.match(result, /我負責清理資料/); assert.match(result, /正式面試額外追問/);
  assert.match(result, /尚未驗證/);
  assert.equal(f.state.documentWrites, 0);
  assert(!f.state.calls.some(c => c.url.includes('googleapis')));
  assert(!JSON.stringify(f.records()).includes('"visitor":"hr"'));
});

test('long jobs, focus verification, old buttons, skip, restart and deletion', () => {
  const f = fixture(); f.step('hr', '職缺對照');
  assert.match(output(f.step('hr', 'x'.repeat(4001))), /最多 4000/);
  assert.match(output(f.step('hr', 'https://example.test/job')), /完整職缺/);
  f.step('hr', 'Python 開發，SQL 加分');
  assert.match(output(f.step('hr', '管理十人團隊')), /複製職缺原文/);
  f.step('hr', 'SQL 加分');
  const draft = f.gas.loadPortfolioStore_(f.gas.config_()).jobMatch.drafts[f.gas.invitationVisitor_('hr')];
  const id = draft.id; f.step('hr', 'jm:submit:' + id, 'submit-once');
  f.step('hr', 'jm:submit:' + id, 'submit-once');
  assert.equal(f.state.calls.filter(c => c.url.endsWith('/push')).length, 1);
  f.step(owner, 'jm:answer:' + id);
  assert.match(output(f.step(owner, 'x'.repeat(801))), /最多 800/);
  f.step(owner, 'jm:skip:' + id + ':0');
  f.step(owner, 'jm:skip:' + id + ':0');
  assert.equal(f.records()[id].answers.length, 1);
  f.step(owner, '第二題'); f.step(owner, '第三題');
  f.step(owner, 'jm:restart:' + id); assert.equal(f.records()[id].answers.length, 0);
  f.step(owner, '取消'); assert.equal(Object.keys(f.records()).length, 0);
  assert.match(output(f.step('hr', 'jm:view:' + id)), /找不到/);
});

test('multiple recruiters remain isolated and pausing preserves answers without eating navigation', () => {
  const f = fixture(), a = f.submit('hr-a'), b = f.submit('hr-b');
  f.step(owner, 'jm:answer:' + a); f.step(owner, 'a 的回答');
  f.step(owner, 'jm:answer:' + b);
  assert.equal(f.records()[a].status, 'paused');
  assert.equal(f.step(owner, 'nav:home'), null);
  assert.equal(f.records()[b].status, 'paused');
  f.step(owner, 'jm:answer:' + a); assert.equal(f.records()[a].answers.length, 1);
  assert.match(output(f.step('hr-b', 'jm:job:' + a)), /找不到/);
});

test('expiry removes private data, unavailable notifications are honest, missing owner blocks submissions', () => {
  const f = fixture(), id = f.submit();
  f.gas.updatePortfolioStore_(f.gas.config_(), store => { store.jobMatch.records[id].expiresAt = 1; });
  assert.match(output(f.step('hr', 'jm:view:' + id)), /找不到/);
  assert.equal(Object.keys(f.records()).length, 0);
  f.state.properties.delete('OWNER_LINE_USER_ID');
  assert.match(output(f.step('hr', '職缺對照')), /尚未設定/);
  const g = fixture(); g.state.response = call => call.url.endsWith('/push') ? { status: 429 } : { body: {} };
  const other = g.submit();
  assert.match(output(g.step('hr', 'jm:view:' + other)), /quota_or_rate_limit/);
  assert.equal(g.records()[other].status, 'waiting');
});

test('webhook routes long job input to private flow, and existing invitations retain priority', () => {
  const f = fixture(); let n = 0;
  const send = (user, text) => { const e = event(text, 'web-' + ++n); e.source.userId = user; return f.gas.handleEvent_(e, f.gas.config_()); };
  send('hr', '職缺對照'); send('hr', 'Python '.repeat(200));
  const d = f.gas.loadPortfolioStore_(f.gas.config_()).jobMatch.drafts[f.gas.invitationVisitor_('hr')];
  assert.equal(d.step, 'focus'); assert.equal(f.state.documentWrites, 0);
  send('hr', '首頁'); send('hr', '留下邀約'); send('hr', '測試公司');
  const invitation = f.gas.invitationDraft_(f.gas.invitationKey_('hr', f.gas.config_()));
  assert.equal(invitation.step, 1);
});
