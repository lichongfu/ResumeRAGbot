/** 招募工作台：資料覆蓋與人工審核，所有候選資料隔離於原訪客的職缺內。 */
function recruitingAllowed_(quote) { return !/年齡|性別|男女|婚姻|懷孕|宗教|種族|膚色|國籍|星座|血型|身心障礙|身高|體重/.test(quote); }
function recruitingRequirements_(s) { return s.requirements.filter(function (r) { return recruitingAllowed_(r.quote); }); }
function recruitingCleanResume_(text) {
  return text.split('\n').filter(function (line) { return recruitingAllowed_(line) && !/(?:e-?mail|電話|手機|住址|身分證|身份證|生日|出生日期)\s*[:：]/i.test(line); }).join('\n').trim();
}
function recruitingStats_(s, candidate) {
  var requirements = recruitingRequirements_(s), supported = requirements.filter(function (r) { return candidate.results[r.id] && candidate.results[r.id].evidence.length; });
  var required = requirements.filter(function (r) { return r.kind === '必要'; });
  return { total: requirements.length, covered: supported.length, rate: requirements.length ? Math.round(supported.length / requirements.length * 100) : null,
    requiredTotal: required.length, requiredCovered: required.filter(function (r) { return candidate.results[r.id] && candidate.results[r.id].evidence.length; }).length };
}
function recruitingButtons_(s) { return [['新增候選人', 'rc:add:' + s.id], ['需求熱圖', 'rc:heat:' + s.id], ['資料覆蓋排序', 'rc:rank:' + s.id],
  ['候選清單', 'rc:list:' + s.id], ['可預約面談時段', 'slot:list'], ['返回這份職缺', 'jg:resume']]; }
function recruitingMenu_(s) {
  var count = Object.keys((s.recruiting || {}).candidates || {}).length;
  var actions = [['新增候選人', 'rc:add:' + s.id], ['加入此 bot 履歷', 'rc:owner:' + s.id], ['需求熱圖', 'rc:heat:' + s.id], ['資料覆蓋排序', 'rc:rank:' + s.id], ['候選清單／人工決定', 'rc:list:' + s.id], ['返回職缺', 'jg:resume']];
  var pending = s.recruiting && s.recruiting.input;
  if (pending) actions.unshift(['取消目前輸入', 'rc:cancel:' + s.id]);
  return jobMessage_('招募工作台\n' + s.job.split('\n')[0].slice(0, 80) + '\n\n目前 ' + count + ' / 5 位候選人。所有候選人使用同一份職缺條件。\n可逐份貼上已獲授權的履歷文字，或加入這個 bot 的公開履歷。\n\n一般 LINE 使用者彼此分開存取；資料存在 bot 主人的私人 Drive，檔案持有人仍可讀取。\n百分比只計算引文覆蓋率，不是能力分數、適任機率或錄取建議。最後決定由人資人工記錄。',
    actions);
}
function recruitingFresh_(s, cfg) {
  var candidates = (s.recruiting || {}).candidates || {};
  Object.keys(candidates).forEach(function (id) { if (candidates[id].kind === 'owner') guideSource_(cfg, candidates[id].fingerprint); });
}
function recruitingHeat_(s) {
  var candidates = Object.keys((s.recruiting || {}).candidates || {}).map(function (id) { return s.recruiting.candidates[id]; });
  if (!candidates.length) return jobMessage_('先新增候選人，才能產生需求熱圖。', recruitingButtons_(s));
  var rows = [{ type: 'box', layout: 'horizontal', spacing: 'xs', contents: [{ type: 'text', text: '條件', flex: 2, size: 'xs', weight: 'bold' }].concat(candidates.map(function (c, i) {
    return { type: 'text', text: 'C' + (i + 1), flex: 1, align: 'center', size: 'xs', weight: 'bold' };
  })) }];
  s.requirements.forEach(function (r, i) {
    rows.push({ type: 'box', layout: 'horizontal', spacing: 'xs', margin: 'sm', contents: [{ type: 'text', text: 'R' + (i + 1), flex: 2, size: 'xs' }].concat(candidates.map(function (c) {
      var allowed = recruitingAllowed_(r.quote), supported = allowed && c.results[r.id] && c.results[r.id].evidence.length;
      return { type: 'box', layout: 'vertical', flex: 1, cornerRadius: '4px', paddingAll: '4px', backgroundColor: !allowed ? '#E5E7EB' : supported ? '#DCFCE7' : '#FEF3C7',
        contents: [{ type: 'text', text: !allowed ? '排除' : supported ? '原文' : '待查', size: 'xxs', align: 'center', color: '#1F2937' }] };
    })) });
  });
  return [jobMessage_('需求熱圖｜綠：有可核對原文；黃：待確認；灰：不納入評估。\n顏色不代表能力高低。\n\n' + candidates.map(function (c, i) { return 'C' + (i + 1) + '：' + c.name; }).join('\n') + '\n\n' +
    s.requirements.map(function (r, i) { return 'R' + (i + 1) + ' [' + r.kind + '] ' + r.quote; }).join('\n'), recruitingButtons_(s))[0],
    { type: 'flex', altText: '需求熱圖：資料支持狀態，非能力評分', contents: { type: 'bubble', size: 'mega', body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: rows } } }];
}
function recruitingCompare_(s) {
  var candidates = Object.keys((s.recruiting || {}).candidates || {}).map(function (id, i) { var c = s.recruiting.candidates[id]; return { c: c, stats: recruitingStats_(s, c), order: i }; });
  candidates.sort(function (a, b) { return b.stats.requiredCovered - a.stats.requiredCovered || (b.stats.rate || 0) - (a.stats.rate || 0) || a.order - b.order; });
  return jobMessage_('候選資料覆蓋排序｜供人工查閱\n\n' + (candidates.length ? candidates.map(function (entry, i) {
    return (i + 1) + '. ' + entry.c.name + '\n必要條件原文：' + entry.stats.requiredCovered + '/' + entry.stats.requiredTotal +
      '；全部條件原文：' + entry.stats.covered + '/' + entry.stats.total + '（' + (entry.stats.rate === null ? '不計算' : entry.stats.rate + '%') + '）\n人工決定：' + (entry.c.decision ? entry.c.decision.label : '尚未審核');
  }).join('\n\n') : '尚無候選人。') + '\n\n排序先看必要條件的原文筆數，再看全部資料覆蓋率；同分維持加入順序。履歷寫得多不等於能力較強，缺資料也不代表不會。不自動淘汰或錄取。', recruitingButtons_(s));
}
function recruitingEvaluate_(s, resume, cfg) {
  var lines = [];
  resume.split(/\n+/).filter(Boolean).forEach(function (line) { for (var i = 0; i < line.length; i += 600) lines.push({ id: 'C' + (lines.length + 1), text: line.slice(i, i + 600) }); });
  var requirements = recruitingRequirements_(s);
  if (!requirements.length) throw new Error('RECRUITING_NO_JOB_CRITERIA');
  var value = guideModel_({ requirements: requirements, resume: lines }, { type: 'OBJECT', properties: {
    candidateEvidence: { type: 'ARRAY', items: { type: 'OBJECT', properties: { requirementId: { type: 'STRING' }, evidence: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      lineId: { type: 'STRING' }, quote: { type: 'STRING' }
    }, required: ['lineId', 'quote'] } } }, required: ['requirementId', 'evidence'] } }
  }, required: ['candidateEvidence'] },
  '只整理每項工作條件的相關原文，每項回傳一筆 candidateEvidence，最多兩則引文；lineId 必須存在，quote 逐字摘錄該片段的連續原文，4～160 字，保留否定、限制及實際角色。沒有直接相關依據就 evidence=[]。不得推論能力分數、符合機率、人格、年齡、性別等無關特徵或錄取決定。不要因為工具名稱而推定年資、主導角色或實績。', cfg);
  if (!value || !Array.isArray(value.candidateEvidence) || value.candidateEvidence.length !== requirements.length) throw new Error('RECRUITING_INVALID_FORMAT');
  var results = {};
  value.candidateEvidence.forEach(function (item) {
    if (!item || !requirements.some(function (r) { return r.id === item.requirementId; }) || results[item.requirementId] || !Array.isArray(item.evidence) || item.evidence.length > 2) throw new Error('RECRUITING_INVALID_FORMAT');
    var seen = {};
    results[item.requirementId] = { evidence: item.evidence.map(function (e) {
      var line = e && lines.find(function (l) { return l.id === e.lineId; });
      if (!line || seen[e.lineId] || typeof e.quote !== 'string' || e.quote.length < 4 || e.quote.length > 160 || line.text.indexOf(e.quote) < 0) throw new Error('GUIDE_INVALID_QUOTE');
      seen[e.lineId] = true; return { id: line.id, quote: e.quote, section: '人資提供的履歷片段 ' + line.id };
    }) };
  });
  return results;
}
function recruitingView_(s, c) {
  var stats = recruitingStats_(s, c);
  return journeyTextMessages_(c.name + '\n資料來源：' + (c.kind === 'owner' ? '此 bot 公開履歷' : '人資提供文字，尚未查證真實性') + '\n證據覆蓋率：' + (stats.rate === null ? '不計算' : stats.rate + '%') + '\n\n' +
    s.requirements.map(function (r, i) { return (i + 1) + '. ' + r.quote + '\n' + (!recruitingAllowed_(r.quote) ? '不納入評估。' :
      c.results[r.id] && c.results[r.id].evidence.length ? c.results[r.id].evidence.map(function (e) { return '「' + e.quote + '」\n來源：' + e.section; }).join('\n') : '待確認；未記載不代表不具備。'); }).join('\n\n') +
    '\n\n人工決定：' + (c.decision ? c.decision.label + '\n理由：' + c.decision.reason : '尚未審核') +
    (c.previousDecision ? '\n前次決定（來源更新後需重審）：' + c.previousDecision.label + '；' + c.previousDecision.reason : '') + '\n系統不自動決定錄取或淘汰。',
    [['查看提供的履歷', 'rc:source:' + s.id + ':' + c.id], ['記錄人工決定', 'rc:decision:' + s.id + ':' + c.id], ['刪除候選資料', 'rc:delete:' + s.id + ':' + c.id], ['返回工作台', 'rc:menu']]);
}

function handleRecruiting_(event, text, cfg) {
  var aliases = { '招募工作台': 'menu', '需求熱圖': 'heat', '候選比較': 'rank', '候選清單': 'list' };
  var alias = Object.prototype.hasOwnProperty.call(aliases, text) ? aliases[text] : '';
  var user = event.source.userId, explicit = /^rc:/.test(text) || !!alias, parts = text.split(':'), s;
  try {
    s = guideRead_(user, cfg); if (s && s.expired) { guideChange_(user, cfg, function () {}); s = null; }
    if (s && s.recruiting && s.recruiting.lastEvent === eventKey_(event)) return recruitingMenu_(s);
    if (s && s.recruiting && s.recruiting.lastReasonEvent === eventKey_(event)) {
      var pendingDecision = s.recruiting.input;
      if (pendingDecision && pendingDecision.kind === 'decision' && pendingDecision.reason) return jobMessage_('請確認人工決定與理由：\n' + pendingDecision.reason,
        [['確認記錄', 'rc:confirm:' + s.id + ':' + pendingDecision.candidateId + ':' + pendingDecision.token], ['返回清單', 'rc:list:' + s.id]]);
      return recruitingMenu_(s);
    }
    var input = s && s.recruiting && s.recruiting.input;
    if (!explicit && !input) return null;
    if (invitationDraft_(invitationKey_(user, cfg)) && invitationDraft_(invitationKey_(user, cfg)).step < 5) return explicit ? jobMessage_('請先完成或取消目前邀約。') : null;
    if (!s || !s.requirements || !s.requirementsConfirmed && !s.fingerprint) return explicit ? jobMessage_('先貼職缺並確認條件，再開啟招募工作台。', [['貼職缺', 'jg:start']]) : null;
    if (explicit && parts[2] && parts[2] !== s.id) return jobMessage_('這個按鈕屬於舊職缺，請開啟目前工作台。', [['招募工作台', 'rc:menu']]);
    if (!explicit && (/^(?:jg:|jm:|slot:|invite:|nav:|topic:|work:)/.test(text) || /^(首頁|取消|看履歷|貼職缺|聯繫邀約)$/.test(text))) {
      guideChange_(user, cfg, function (rows, actor) { if (rows[actor].recruiting) { delete rows[actor].recruiting.input; delete rows[actor].recruiting.lease; delete rows[actor].recruiting.busyUntil; } });
      return text === '取消' ? recruitingMenu_(s) : null;
    }
    if (input && input.expiresAt <= Date.now()) { guideChange_(user, cfg, function (rows, actor) { delete rows[actor].recruiting.input; }); return jobMessage_('輸入已過期，剛才內容未送給 AI。', [['招募工作台', 'rc:menu']]); }
    var action = explicit ? parts[1] || 'menu' : '';
    if (alias) action = alias;
    if (action === 'cancel') { guideChange_(user, cfg, function (rows, actor) { if (rows[actor].recruiting) { delete rows[actor].recruiting.input; delete rows[actor].recruiting.lease; delete rows[actor].recruiting.busyUntil; } }); return recruitingMenu_(guideRead_(user, cfg)); }
    if (action === 'menu') return recruitingMenu_(s);
    if (action === 'list') {
      var all = Object.keys((s.recruiting || {}).candidates || {}).map(function (id) { return s.recruiting.candidates[id]; });
      return jobMessage_(all.length ? '選擇候選人查看原文與人工決定。' : '尚未新增候選人。', all.map(function (c, i) { return [(i + 1) + '. ' + c.name.slice(0, 15), 'rc:view:' + s.id + ':' + c.id]; }).concat([['新增候選人', 'rc:add:' + s.id], ['返回工作台', 'rc:menu']]));
    }
    if (action === 'heat' || action === 'rank') { recruitingFresh_(s, cfg); return action === 'heat' ? recruitingHeat_(s) : recruitingCompare_(s); }
    if (action === 'add') {
      if (Object.keys((s.recruiting || {}).candidates || {}).length >= 5) return jobMessage_('每份職缺最多五位候選人，請先刪除不再使用的資料。', recruitingButtons_(s));
      guideChange_(user, cfg, function (rows, actor) { var row = rows[actor]; row.recruiting = row.recruiting || { candidates: {} }; row.recruiting.input = { kind: 'resume', expiresAt: Date.now() + 1800000 }; row.paused = true; });
      return jobMessage_('請貼上已獲授權的履歷文字，最多 4000 字：\n\n候選人代號：候選 A\n履歷：\n專案、本人負責內容、技能與成果……\n\n只貼與工作有關的資料；姓名可用代號。文字將交由 Gemini 找引文，與目前職缺一起私人保存 24 小時，不公開、不寫入原履歷。輸入「取消」離開。');
    }
    if (action === 'owner') {
      guideSource_(cfg, s.fingerprint);
      if (!s.fingerprint || !s.results || Object.keys(s.results).length !== s.requirements.length) return jobMessage_('請先完成此履歷的證據比對。', [['繼續職缺', 'jg:resume']]);
      var ownerId = sha256_('owner:' + s.id).slice(0, 16);
      var added = guideChange_(user, cfg, function (rows, actor) { var row = rows[actor]; row.recruiting = row.recruiting || { candidates: {} };
        var previous = row.recruiting.candidates[ownerId];
        if (!previous && Object.keys(row.recruiting.candidates).length >= 5) return false;
        if (previous && previous.fingerprint === s.fingerprint) return true;
        row.recruiting.candidates[ownerId] = { id: ownerId, kind: 'owner', name: cfg.name.slice(0, 40), fingerprint: s.fingerprint, results: s.results, createdAt: Date.now() };
        if (previous && previous.decision) row.recruiting.candidates[ownerId].previousDecision = previous.decision;
        return true; });
      return added ? recruitingMenu_(guideRead_(user, cfg)) : jobMessage_('已達五位候選人上限，未加入此 bot 履歷。', recruitingButtons_(s));
    }
    var candidate = (s.recruiting || {}).candidates && s.recruiting.candidates[parts[3]];
    if (['view', 'source', 'decision', 'choose', 'confirm', 'delete', 'deleteyes'].indexOf(action) >= 0 && !candidate) return jobMessage_('找不到這份職缺的候選資料。', [['候選清單', 'rc:list:' + s.id]]);
    if (candidate && candidate.kind === 'owner' && ['view', 'source', 'decision', 'choose', 'confirm'].indexOf(action) >= 0) guideSource_(cfg, candidate.fingerprint);
    if (action === 'source') return candidate.kind === 'owner' ? recruitingView_(s, candidate) : journeyTextMessages_('人資提供的履歷文字（已排除部分無關個資，真實性待查證）\n\n' + candidate.source, [['返回候選資料', 'rc:view:' + s.id + ':' + candidate.id]]);
    if (action === 'view') { recruitingFresh_(s, cfg); return recruitingView_(s, candidate); }
    var choices = { interview: '邀請面談', hold: '待補充', reject: '不續辦', offer: '錄取（人工記錄）' };
    if (action === 'decision') return jobMessage_('由你人工決定 ' + candidate.name + ' 的下一步；系統只記錄，不自動通知候選人。', Object.keys(choices).map(function (key) { return [choices[key], 'rc:choose:' + s.id + ':' + candidate.id + ':' + key]; }).concat([['返回', 'rc:view:' + s.id + ':' + candidate.id]]));
    if (action === 'choose' && Object.prototype.hasOwnProperty.call(choices, parts[4])) {
      guideChange_(user, cfg, function (rows, actor) { rows[actor].recruiting.input = { kind: 'decision', candidateId: candidate.id, choice: parts[4], expiresAt: Date.now() + 1800000 }; rows[actor].paused = true; });
      return jobMessage_('請輸入與職務相關的人工判斷理由（4～300 字）。這段理由不交給 AI；下一步仍需確認。輸入「取消」離開。');
    }
    if (action === 'confirm') {
      if (!input || input.kind !== 'decision' || input.candidateId !== candidate.id || !input.reason || input.token !== parts[4]) return jobMessage_('這份人工決定已失效，請重新審核。', [['查看候選人', 'rc:view:' + s.id + ':' + candidate.id]]);
      guideChange_(user, cfg, function (rows, actor) { var row = rows[actor]; row.recruiting.candidates[candidate.id].decision = { label: choices[input.choice], reason: input.reason, recordedAt: new Date().toISOString(), by: '人資人工確認' }; delete row.recruiting.input; });
      return recruitingView_(guideRead_(user, cfg), guideRead_(user, cfg).recruiting.candidates[candidate.id]);
    }
    if (action === 'delete') return jobMessage_('刪除 ' + candidate.name + ' 的比較資料？不會自動取消既有預約。', [['確認刪除', 'rc:deleteyes:' + s.id + ':' + candidate.id], ['保留', 'rc:list:' + s.id]]);
    if (action === 'deleteyes') { guideChange_(user, cfg, function (rows, actor) { delete rows[actor].recruiting.candidates[candidate.id]; }); return recruitingMenu_(guideRead_(user, cfg)); }
    if (!explicit && input && event.type === 'message') {
      if (input.kind === 'decision') {
        if (text.length < 4 || text.length > 300 || !recruitingAllowed_(text)) return jobMessage_('請以 4～300 字說明與工作相關的依據，勿使用年齡、性別等無關特徵。');
        var token = sha256_(Utilities.getUuid()).slice(0, 12);
        guideChange_(user, cfg, function (rows, actor) { rows[actor].recruiting.input.reason = text; rows[actor].recruiting.input.token = token; rows[actor].recruiting.lastReasonEvent = eventKey_(event); journeyRemember_(rows[actor], event); });
        return jobMessage_('請確認人工決定：' + choices[input.choice] + '\n理由：' + text + '\n不會自動通知候選人。', [['確認記錄', 'rc:confirm:' + s.id + ':' + input.candidateId + ':' + token], ['返回候選清單', 'rc:list:' + s.id]]);
      }
      if (text.length > 4000) return jobMessage_('履歷文字最多 4000 字，請縮短後再貼，不會默默截斷。');
      var match = /^候選人(?:代號|姓名)?\s*[:：]\s*([^\n]{1,40})\n履歷\s*[:：]\s*([\s\S]+)$/.exec(text);
      if (!match) return jobMessage_('請依格式貼上：\n候選人代號：候選 A\n履歷：\n與工作相關的經驗、專案與成果。');
      var resume = recruitingCleanResume_(match[2]); if (resume.length < 20) return jobMessage_('可用的工作經驗資料不足 20 字，請補充；無關個資不納入評估。');
      var signature = sha256_(JSON.stringify(s.requirements)), lease = Utilities.getUuid(), reserved = guideChange_(user, cfg, function (rows, actor) { var row = rows[actor]; if (row.id !== s.id || row.recruiting.busyUntil > Date.now() || Object.keys(row.recruiting.candidates).length >= 5) return false;
        if (row.recruiting.lastEvent === eventKey_(event)) return false; row.recruiting.lease = lease; row.recruiting.busyUntil = Date.now() + 90000; return true; });
      if (!reserved) return jobMessage_('正在處理或候選數量已滿，請查看目前清單。', [['候選清單', 'rc:list:' + s.id]]);
      var results, error; try { startLoading_(user, cfg); results = recruitingEvaluate_(s, resume, cfg); } catch (e) { error = e; }
      var saved = guideChange_(user, cfg, function (rows, actor) { var row = rows[actor]; if (!row || row.id !== s.id || !row.recruiting || row.recruiting.lease !== lease) return null;
        delete row.recruiting.lease; delete row.recruiting.busyUntil;
        if (sha256_(JSON.stringify(row.requirements)) !== signature) return null;
        if (!error) { var id = sha256_(Utilities.getUuid()).slice(0, 16); row.recruiting.candidates[id] = { id: id, name: match[1].trim(), kind: 'text', source: resume, results: results, createdAt: Date.now() }; row.recruiting.lastEvent = eventKey_(event); journeyRemember_(row, event); delete row.recruiting.input; }
        return row; });
      if (!saved) return jobMessage_('操作已取消或職缺條件已變更，未加入舊請求結果。', [['招募工作台', 'rc:menu']]);
      if (error) { safeLog_('RECRUITING_' + errorCode_(error)); return jobMessage_(/^GEMINI_HTTP_/.test(errorCode_(error)) ? ragErrorMessage_(error) : '候選資料引用或格式未通過核對，尚未加入；可重貼同一份資料重試。'); }
      return recruitingMenu_(saved);
    }
    return recruitingMenu_(s);
  } catch (error) { safeLog_('RECRUITING_' + errorCode_(error)); return jobMessage_(errorCode_(error) === 'GUIDE_STALE_SOURCE' ? '原履歷已更新，請重新比對並更新此 bot 候選資料後再比較。' : '工作台暫時無法完成，請稍後重試。', [['招募工作台', 'rc:menu']]); }
}

/** 預填可修改的摘要；完整職缺隨確認保存，不把三題原始回答默默寄出。 */
function startJobInvitation_(event, s, cfg) {
  guideSource_(cfg, s.fingerprint);
  var key = invitationKey_(event.source.userId, cfg), existing = invitationDraft_(key);
  if (existing && existing.step < 5) return existing.step < 4 ? invitationPrompt_(existing) : invitationConfirmation_(existing);
  handleContact_(event, 'invite:start', cfg, null);
  var draft = invitationDraft_(key); if (!draft) return jobMessage_('邀約草稿未能建立，請稍後再試。');
  var summary = s.job.split('\n')[0].slice(0, 100) + '\n\n職缺對照重點：\n' + s.requirements.map(function (r) {
    return '• ' + r.quote.slice(0, 50) + (r.quote.length > 50 ? '…' : '') + '：' + (s.results[r.id] && s.results[r.id].evidence.length ? '有相關原文，需核對' : '待確認');
  }).join('\n');
  if (s.interview && s.interview.followups) summary += '\n\n想先請教本人的問題：\n' + s.interview.followups.slice(0, 2).map(function (q) { return '• ' + q.text.slice(0, 85) + (q.text.length > 85 ? '…' : ''); }).join('\n');
  if (summary.length > 760) summary = summary.slice(0, 730) + '\n（摘要節錄，原職缺另保存）';
  draft.fields.message = summary; draft.prefilled = true; draft.context = { job: s.job, jobId: s.id, sourceFingerprint: s.fingerprint };
  CacheService.getScriptCache().put(key, JSON.stringify(draft), 1800);
  return [jobMessage_('已帶入職稱、對照摘要及待確認問題。先填公司與稱呼；送出前可預覽及修改。原職缺會隨邀約保存，原始三題回答不會自動寄出。')[0]].concat(invitationPrompt_(draft));
}
