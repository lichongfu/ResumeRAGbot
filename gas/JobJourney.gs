/** 一份職缺：貼上 → 確認 → 證據比對及三題訪談 → 確認回答 → 結果／邀約。 */
function journeyToken_(s) { return sha256_(s.id + ':' + (s.interview && s.interview.id || '') + ':' + (s.interview && s.interview.revision || 0)).slice(0, 12); }
function journeyRemember_(s, event) {
  s.events = (s.events || []).filter(function (key) { return key !== eventKey_(event); }).concat([eventKey_(event)]).slice(-30);
  s.updatedAt = Date.now();
}
function journeyNew_(old) {
  return { id: sha256_(Utilities.getUuid()).slice(0, 16), version: 2, stage: 'input', results: {}, events: old && old.events || [],
    updatedAt: Date.now(), expiresAt: Date.now() + 86400000 };
}
function journeyInput_(s) {
  return jobMessage_('職缺面試流程｜1 / 5 貼上職缺\n\n請貼職稱、工作內容與條件（20～4000 字），不要只貼職稱或網址。\n接著確認條件、回答 AI 三題，再查看同一份職缺的整合結果。無須切換角色。\n\n職缺、檢索片段與確認送出的補充回答會交由 Gemini 處理，私人保存 24 小時。請勿貼機密資料。',
    [['看範例', 'jg:example:' + s.id], ['資料使用說明', 'jg:info:' + s.id], ['回首頁', 'nav:home']]);
}
function journeyReview_(s) {
  return jobMessage_('職缺面試流程｜2 / 5 確認條件\n' + s.job.split('\n')[0].slice(0, 80) + '\n\n' +
    s.requirements.map(function (r, i) { return (i + 1) + '. [' + r.kind + '] ' + r.quote; }).join('\n') +
    '\n\n最多六項重點，未必涵蓋全部需求。確認後，AI 會比對公開履歷並依據資料缺口提出三題。',
    [['確認，開始比對與訪談', 'jg:compare:' + s.id], ['調整條件', 'jg:conditions:' + s.id], ['更換職缺', 'jg:job:' + s.id]]);
}
function journeyActions_(s) {
  if (s.stage === 'complete') return [['證據與作品', 'jg:evidence:' + s.id], ['三題回答', 'jg:answers:' + s.id],
    ['面試追問', 'jg:questions:' + s.id], ['完整準備單', 'jg:report:' + s.id], ['留下邀約', 'jg:invite:' + s.id],
    ['招募工作台／需求熱圖', 'rc:menu'], ['預約面談', 'slot:list'], ['職缺設定', 'jg:options:' + s.id]];
  return [['繼續這份職缺', 'jg:resume'], ['回首頁', 'nav:home']];
}
function journeyPrompt_(s) {
  var interview = s.interview, question = interview.questions[interview.cursor], token = journeyToken_(s);
  return jobMessage_('職缺面試流程｜3 / 5 AI 訪談 ' + (interview.cursor + 1) + ' / 3\n' + s.job.split('\n')[0].slice(0, 70) +
    '\n\n' + question.text + '\n\n請直接回答，最多 800 字。可略過或稍後繼續。補充內容會標示為「' + interview.origin + '」，不直接變成履歷事實；三題完成後仍可修改並確認。',
    [['略過這題', 'jg:skip:' + s.id + ':' + token], ['稍後繼續', 'jg:leave:' + s.id], ['查看相關證據', 'jg:evidence:' + s.id], ['人資：候選比較', 'rc:menu'], ['職缺設定', 'jg:options:' + s.id]]);
}
function journeyAnswersText_(s) {
  var interview = s.interview;
  return '【' + interview.origin + '；尚未查證】\n' + interview.questions.map(function (q, i) {
    return (i + 1) + '. ' + q.text + '\n回答：' + (interview.answers[i] === null ? '尚未回答' : interview.answers[i]);
  }).join('\n\n');
}
function journeyPreview_(s) {
  var actions = [['確認，整理面試結果', 'jg:finalize:' + s.id + ':' + journeyToken_(s)]];
  s.interview.questions.forEach(function (q, i) { actions.push(['修改第 ' + (i + 1) + ' 題', 'jg:edit:' + s.id + ':' + q.id]); });
  actions.push(['稍後確認', 'jg:leave:' + s.id]);
  return jobMessage_('職缺面試流程｜4 / 5 確認三題回答\n\n' + journeyAnswersText_(s) +
    '\n\n確認後，Gemini 會根據這些補充產生正式面試的深入追問。內容只更新這份私人準備單，不寫回公開履歷、不寄信或通知其他人。', actions);
}
function journeySummary_(s) {
  var found = 0;
  var lines = s.requirements.map(function (r, i) {
    var hasEvidence = s.results[r.id] && s.results[r.id].evidence.length;
    if (hasEvidence) found++;
    return (i + 1) + '. ' + r.quote.slice(0, 65) + (r.quote.length > 65 ? '…' : '') + '｜' + (hasEvidence ? '有相關原文' : '待確認');
  });
  return jobMessage_('職缺面試流程｜5 / 5 整合結果\n' + s.job.split('\n')[0].slice(0, 80) + '\n\n' + lines.join('\n') +
    '\n\n有相關原文 ' + found + ' 項／待確認 ' + (s.requirements.length - found) + ' 項。這是資料數量，不是能力分數。\n三題補充已確認，仍屬填寫者陳述、尚未查證。\n\n可在同一份職缺查看證據與作品、補充回答及正式面試追問，或留下邀約。', journeyActions_(s));
}
function journeyRender_(s) {
  if (s.pendingJob) return jobMessage_('確認更換職缺？\n\n' + s.pendingJob.slice(0, 1800) +
    '\n\n確認後將職缺交由 Gemini 重新整理，並取代目前這份職缺及訪談內容。未確認前，原資料保留。',
    [['確認更換', 'jg:replace:' + s.id + ':' + sha256_(s.pendingJob).slice(0, 12)], ['保留原職缺', 'jg:keep:' + s.id]]);
  if (s.awaitingReplacement) return jobMessage_('請貼上新的完整職缺。原職缺與回答保留到你確認更換；也可保留原職缺繼續。', [['保留原職缺', 'jg:keep:' + s.id]]);
  if (s.stage === 'input') return journeyInput_(s);
  if (s.stage === 'extract') return jobMessage_('職缺已保存，條件整理尚未完成。請重試，不需重新貼上。', [['重試整理條件', 'jg:extract:' + s.id], ['更換職缺', 'jg:job:' + s.id]]);
  if (s.stage === 'review') return journeyReview_(s);
  if (s.stage === 'interview') return journeyPrompt_(s);
  if (s.stage === 'reviewAnswers') return journeyPreview_(s);
  if (s.stage === 'complete') return journeySummary_(s);
  return jobMessage_('這份職缺已保存。下一步：比對履歷證據，並直接開始 AI 三題訪談。', [['開始比對與訪談', 'jg:compare:' + s.id], ['更換職缺', 'jg:job:' + s.id]]);
}
function journeyError_(error, s) {
  var code = errorCode_(error), message;
  if (code === 'GUIDE_STALE_SOURCE') message = '履歷來源已更動或尚未同步，暫停顯示舊證據。請本人同步履歷後重新比對；既有回答會保留為前次紀錄。';
  else if (/^(GUIDE_|JOURNEY_)/.test(code)) message = 'AI 的格式或引用未通過核對，未將它當成有效結果。職缺與已保存回答仍保留，請重試。';
  else message = ragErrorMessage_(error);
  var actions = [['繼續這份職缺', 'jg:resume']];
  if (s && code === 'GUIDE_STALE_SOURCE') actions = [['同步後重新比對', 'jg:compare:' + s.id], ['查看已填回答', 'jg:answers:' + s.id]];
  else if (s && s.stage === 'extract') actions = [['重試整理條件', 'jg:extract:' + s.id]];
  else if (s && s.stage === 'reviewAnswers') actions = [['重試整理結果', 'jg:finalize:' + s.id + ':' + journeyToken_(s)]];
  else if (s && s.requirements) actions = [['重試比對與訪談', 'jg:compare:' + s.id]];
  return jobMessage_(message, actions);
}
function journeyEvidenceText_(s) {
  return s.requirements.map(function (r, i) {
    var result = s.results[r.id];
    return (i + 1) + '. [' + r.kind + '] ' + r.quote + '\n' + (!result ? '尚未比對。' : result.evidence.length ?
      result.evidence.map(function (e) { return '「' + e.quote + '」\n來源：' + e.section + ' [' + e.id + ']' + (e.imageKey ? '（圖片觀察，非本人貢獻證明）' : ''); }).join('\n') :
      '本次檢索未找到可核對引用，待面談確認；不代表不具備能力。');
  }).join('\n\n');
}
function journeyFollowupsText_(s) {
  return '【正式面試追問】\n' + s.interview.followups.map(function (q, i) {
    var r = s.requirements.find(function (item) { return item.id === q.requirementId; });
    return (i + 1) + '. ' + q.text + '\n對應條件：' + r.quote;
  }).join('\n\n');
}
function journeyTextMessages_(text, actions) {
  var messages = [];
  while (text.length) { var cut = text.length <= 3700 ? text.length : text.lastIndexOf('\n', 3700); if (cut < 1) cut = 3700;
    messages.push({ type: 'text', text: text.slice(0, cut) }); text = text.slice(cut).replace(/^\n/, ''); }
  messages.push(jobMessage_('繼續操作這份職缺：', actions)[0]);
  return messages;
}
function journeyReport_(s) {
  return journeyTextMessages_('職缺面談準備單\n' + s.job.split('\n')[0].slice(0, 100) + '\n整理時間：' +
    Utilities.formatDate(new Date(s.updatedAt), 'Asia/Taipei', 'yyyy-MM-dd HH:mm') + '（台北時間）\n\n【公開履歷證據】\n' +
    journeyEvidenceText_(s) + '\n\n' + journeyAnswersText_(s) + '\n\n' + journeyFollowupsText_(s) +
    '\n\n可長按複製給主管。引用經逐字核對，語意與真實性仍需查證；補充回答未變成公開履歷事實。本單不評分、不代替錄取決定。', journeyActions_(s));
}

/** 一批查詢向量及一次生成，取代逐項點擊；每項仍只接受自己的檢索引用。 */
function journeyAnalyze_(s, cfg, prepared) {
  var data = geminiRequest_(cfg.embeddingModel, 'batchEmbedContents', { requests: s.requirements.map(function (r) {
    return embeddingRequest_(r.quote, 'RETRIEVAL_QUERY', '', cfg);
  }) }, cfg, false);
  if (!data || !Array.isArray(data.embeddings) || data.embeddings.length !== s.requirements.length) throw new Error('INVALID_EMBEDDING_BATCH');
  var candidates = {}, evidence = {}, requirements = s.requirements.map(function (r, i) {
    var vector = normalizeVector_(data.embeddings[i] && data.embeddings[i].values, cfg.dimensions);
    var hits = rankChunks_(r.quote, vector, prepared.index.chunks, { minSimilarity: cfg.minSimilarity, topK: 3 });
    candidates[r.id] = hits;
    hits.forEach(function (h) { evidence[h.id] = { id: h.id, section: h.section, text: h.text, imageObservation: !!h.imageKey }; });
    return { id: r.id, quote: r.quote, kind: r.kind, allowedEvidenceIds: hits.map(function (h) { return h.id; }) };
  });
  var questionSchema = { type: 'OBJECT', properties: { requirementId: { type: 'STRING' }, text: { type: 'STRING' } }, required: ['requirementId', 'text'] };
  var result = guideModel_({ requirements: requirements, evidence: Object.keys(evidence).map(function (id) { return evidence[id]; }) },
    { type: 'OBJECT', properties: {
      journeyComparisons: { type: 'ARRAY', items: { type: 'OBJECT', properties: { requirementId: { type: 'STRING' },
        evidence: { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: { type: 'STRING' }, quote: { type: 'STRING' } }, required: ['id', 'quote'] } } }, required: ['requirementId', 'evidence'] } },
      journeyQuestions: { type: 'ARRAY', items: questionSchema }
    }, required: ['journeyComparisons', 'journeyQuestions'] },
    '對每項條件輸出一筆 journeyComparisons，最多兩筆 evidence。只能用該條件 allowedEvidenceIds 中的 id，quote 逐字複製同一片段的連續原文（4～160 字），保留否定與限制。關鍵字相同不代表符合，無直接關聯就用空陣列。圖片只代表可見內容。另產生恰好三題不同的 journeyQuestions，依資料不足、本人貢獻及成果驗證的缺口安排優先順序；即使只有一項條件也從三個不同面向詢問。每題帶有效 requirementId，繁體中文 4～180 字，不含網址、未證實斷言或無關個資。這是準備訪談，不能重問已明確記載的事實。', cfg);
  if (!result || !Array.isArray(result.journeyComparisons) || result.journeyComparisons.length !== requirements.length) throw new Error('JOURNEY_INVALID_FORMAT');
  var results = {};
  result.journeyComparisons.forEach(function (item) {
    if (!item || !candidates[item.requirementId] || results[item.requirementId] || !Array.isArray(item.evidence) || item.evidence.length > 2) throw new Error('JOURNEY_INVALID_FORMAT');
    var seen = {};
    results[item.requirementId] = { evidence: item.evidence.map(function (e) {
      var hit = e && candidates[item.requirementId].find(function (h) { return h.id === e.id; });
      if (!hit || seen[e.id] || typeof e.quote !== 'string' || e.quote.length < 4 || e.quote.length > 160 || hit.text.indexOf(e.quote) < 0) throw new Error('GUIDE_INVALID_QUOTE');
      seen[e.id] = true; return { id: hit.id, section: hit.section.slice(0, 100), quote: e.quote, imageKey: hit.imageKey || null };
    }) };
  });
  return { results: results, questions: journeyValidateQuestions_(result.journeyQuestions, s.requirements) };
}
function journeyValidateQuestions_(questions, requirements) {
  if (!Array.isArray(questions) || questions.length !== 3) throw new Error('JOURNEY_INVALID_FORMAT');
  var seen = {};
  return questions.map(function (q) {
    if (!q || !requirements.some(function (r) { return r.id === q.requirementId; }) || typeof q.text !== 'string' ||
        q.text.trim().length < 4 || q.text.length > 180 || /https?:\/\//i.test(q.text) || seen[q.text.trim()]) throw new Error('JOURNEY_INVALID_FORMAT');
    seen[q.text.trim()] = true; return { requirementId: q.requirementId, text: q.text.trim() };
  });
}
function journeyGenerateFollowups_(s, cfg) {
  var result = guideModel_({ requirements: s.requirements, publicEvidence: s.results,
    interview: s.interview.questions.map(function (q, i) { return { question: q.text, requirementId: q.requirementId, answer: s.interview.answers[i] }; }) },
    { type: 'OBJECT', properties: { journeyFollowups: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      requirementId: { type: 'STRING' }, text: { type: 'STRING' }
    }, required: ['requirementId', 'text'] } } }, required: ['journeyFollowups'] },
    '根據已確認的三題補充與公開證據，產生恰好三題不同的正式面試深入追問，避免重複準備訪談。釐清實際貢獻、取捨、驗證方法或仍缺的資料；略過的答案仍屬未知。回答是未查證的填寫者陳述，不能升為履歷事實。每題附有效 requirementId，繁體中文 4～180 字，不含網址、未證實斷言或無關個資。不要替答案評分。', cfg);
  return journeyValidateQuestions_(result && result.journeyFollowups, s.requirements);
}

/** 鎖外呼叫 AI；租約防止舊請求覆蓋更換職缺，失敗保留原步驟可重試。 */
function journeyRun_(event, cfg, id, task, token) {
  var user = event.source.userId, lease = Utilities.getUuid();
  var snapshot = guideChange_(user, cfg, function (rows, actor) {
    var s = rows[actor]; if (!s || s.id !== id) return null;
    if (s.busyUntil > Date.now()) return { busy: true };
    if (task === 'extract' && s.stage !== 'extract' || task === 'compare' && (!s.requirements || s.interview && s.fingerprint && ['interview', 'reviewAnswers', 'complete'].indexOf(s.stage) >= 0) ||
        task === 'finalize' && (s.stage !== 'reviewAnswers' || token !== journeyToken_(s))) return { unchanged: s };
    if (task === 'compare') s.requirementsConfirmed = true;
    s.lease = lease; s.busyUntil = Date.now() + 90000; return JSON.parse(JSON.stringify(s));
  });
  if (!snapshot) return jobMessage_('這張舊卡片已失效，請開啟目前職缺。', [['我的職缺', 'jg:resume']]);
  if (snapshot.busy) return jobMessage_('AI 正在整理這份職缺，請稍候再開啟；不需要重貼或重按開始。', [['繼續這份職缺', 'jg:resume']]);
  if (snapshot.unchanged) return journeySafeRender_(snapshot.unchanged, cfg);
  var result, source, error;
  try {
    if (task === 'extract') result = guideExtract_(snapshot.job, cfg);
    else {
      source = guideSource_(cfg, task === 'finalize' ? snapshot.fingerprint : null);
      result = task === 'compare' ? journeyAnalyze_(snapshot, cfg, source) : journeyGenerateFollowups_(snapshot, cfg);
      guideSource_(cfg, source.source.fingerprint);
    }
  } catch (e) { error = e; safeLog_('JOB_JOURNEY_' + errorCode_(e)); }
  var saved = guideChange_(user, cfg, function (rows, actor) {
    var s = rows[actor]; if (!s || s.id !== id || s.lease !== lease) return null;
    delete s.lease; delete s.busyUntil;
    if (!error) {
      if (task === 'extract') { s.requirements = result; s.stage = 'review'; }
      if (task === 'compare') {
        if (s.interview) s.previousInterview = s.interview;
        s.results = result.results; s.fingerprint = source.source.fingerprint;
        var interviewId = sha256_(Utilities.getUuid()).slice(0, 12);
        s.interview = { id: interviewId, revision: 0, cursor: 0, answers: [null, null, null],
          origin: user === ownerLineUserId_() ? '已設定的履歷本人帳號補充' : '本次對話填寫者補充（未驗證本人）',
          questions: result.questions.map(function (q, i) { q.id = sha256_(interviewId + ':' + i).slice(0, 12); return q; }) };
        s.stage = 'interview';
      }
      if (task === 'finalize') { s.interview.followups = result; s.interview.confirmed = true; s.stage = 'complete'; }
      s.paused = false; journeyRemember_(s, event);
    }
    return s;
  });
  if (!saved) return jobMessage_('職缺或操作已變更，未使用舊請求的結果。', [['我的職缺', 'jg:resume']]);
  if (error) return journeyError_(error, saved);
  return journeySafeRender_(saved, cfg);
}
function journeySafeRender_(s, cfg) {
  if (s.pendingJob || s.awaitingReplacement) return journeyRender_(s);
  if (s.fingerprint && ['interview', 'reviewAnswers', 'complete'].indexOf(s.stage) >= 0) {
    try { guideSource_(cfg, s.fingerprint); } catch (error) { return journeyError_(error, s); }
  }
  return journeyRender_(s);
}

function journeyLegacyRows_(user, cfg) {
  var data = loadPortfolioStore_(cfg).jobMatch || {}, owner = user === ownerLineUserId_(), actor = invitationVisitor_(user);
  var records = Object.keys(data.records || {}).map(function (id) { return data.records[id]; }).filter(function (r) { return r.expiresAt > Date.now() && (owner || r.visitor === actor); });
  var keys = [actor]; if (owner) keys.push(invitationVisitor_(user + ':job-test:' + cfg.docId));
  keys.forEach(function (key) { var draft = (data.drafts || {})[key]; if (draft && draft.job && draft.expiresAt > Date.now()) records.push(draft); });
  return records.filter(function (r) { return typeof r.job === 'string' && r.job.length <= 4000; }).slice(-5).reverse();
}
function handleJobGuide_(event, text, cfg) {
  var user = event.source.userId, command = /^jg:([a-z]+):([a-f0-9]{16})(?::([a-f0-9]{12}))?$/.exec(text);
  var legacy = /^jm:/.test(text) || /^(模擬人資|切回應徵者|結束測試|待回答職缺|我的職缺)$/.test(text);
  var start = ['jg:start', 'jm:start', '貼職缺', '職缺證據導覽', '職缺對照'].indexOf(text) >= 0;
  var resume = ['jg:resume', '面談準備單', '繼續上次職缺', '我的職缺', '待回答職缺', '我的職缺與訪談'].indexOf(text) >= 0;
  var explicit = start || resume || legacy || text === '更多功能' || /^jg:/.test(text), s;
  try {
    s = guideRead_(user, cfg);
    if (s && s.expired) { guideChange_(user, cfg, function () {}); s = null;
      if (!explicit) return jobMessage_('上次職缺資料已過期，這則輸入未送一般問答。請重新開始。', [['貼職缺', 'jg:start']]); }
    if (s && s.version !== 2) s = guideChange_(user, cfg, function (rows, actor) {
      var row = rows[actor]; row.version = 2;
      row.events = (row.events || []).concat(row.inputEvents || []).filter(function (value, i, all) { return all.indexOf(value) === i; }).slice(-30);
      return row;
    });
    if (!explicit && (!s || s.paused && (s.events || []).indexOf(eventKey_(event)) < 0)) return null;
    var invitation = invitationDraft_(invitationKey_(user, cfg));
    if (invitation && invitation.step < 5) {
      if (command && command[1] === 'invite' && s && s.id === command[2]) return invitation.step < 4 ? invitationPrompt_(invitation) : invitationConfirmation_(invitation);
      return explicit ? jobMessage_('目前正在填邀約。請先完成或取消邀約，再回到這份職缺。') : null;
    }
    var navigation = /^(首頁|回首頁|選單|nav:home|取消|清除對話|重新開始|reset|聯繫本人|留下邀約|使用說明|說明|help|隱私|privacy)$/.test(text) || /^(?:invite:|topic:|work:|contact:|nav:contact)/.test(text);
    if (!explicit && navigation) {
      guideChange_(user, cfg, function (rows, actor) { if (rows[actor]) { rows[actor].paused = true; delete rows[actor].lease; delete rows[actor].busyUntil; } });
      return text === '取消' ? jobMessage_('已暫停，職缺與回答仍保留。可隨時回到原步驟；刪除請使用「職缺設定」。', [['繼續這份職缺', 'jg:resume']]) : null;
    }
    if (text === 'jg:legacy') {
      var oldRows = journeyLegacyRows_(user, cfg);
      return jobMessage_(oldRows.length ? '可沿用以下舊版職缺，不必重新貼上。原舊版紀錄不會刪除。' : '沒有可沿用的舊版職缺。',
        oldRows.map(function (r, i) { return ['沿用舊職缺 ' + (i + 1), 'jg:import:' + r.id]; }).concat([['我的職缺', 'jg:resume'], ['貼職缺', 'jg:start']]));
    }
    if (legacy && !start || text === 'jg:more' || text === '更多功能') {
      if (s) {
        if (s.busyUntil > Date.now()) return jobMessage_('AI 正在整理這份職缺，請稍候再開啟。', [['繼續這份職缺', 'jg:resume']]);
        s = guideChange_(user, cfg, function (rows, actor) { rows[actor].paused = false; return rows[actor]; });
        return [jobMessage_('現在已整合為同一份職缺，不需要角色切換，也不需要重新貼上。請從目前步驟繼續。')[0]].concat(journeySafeRender_(s, cfg));
      }
      return jobMessage_('新版將證據、三題訪談與結果放在同一份職缺，不需要角色切換。可先貼職缺，或沿用舊版資料。', [['貼職缺', 'jg:start'], ['沿用舊版職缺', 'jg:legacy']]);
    }
    if (command && command[1] === 'import') {
      var imported = journeyLegacyRows_(user, cfg).find(function (r) { return r.id === command[2]; });
      if (!imported) return jobMessage_('找不到可沿用的舊版職缺。', [['我的職缺', 'jg:resume']]);
      s = guideChange_(user, cfg, function (rows, actor) {
        if (!rows[actor] && Object.keys(rows).length >= 30) return null;
        var row = rows[actor] || journeyNew_(); row.pendingJob = imported.job; row.paused = false; rows[actor] = row; return row;
      });
      return s ? journeyRender_(s) : jobMessage_('目前使用人數較多，請稍後再試。');
    }
    if (start) {
      if (s && s.job) return jobMessage_('你已有這份職缺：\n' + s.job.split('\n')[0].slice(0, 100) + '\n\n要繼續原步驟，還是換一份？', [['繼續這份職缺', 'jg:resume'], ['更換職缺', 'jg:job:' + s.id]]);
      s = guideChange_(user, cfg, function (rows, actor) { if (!rows[actor] && Object.keys(rows).length >= 30) return null; rows[actor] = rows[actor] || journeyNew_(); rows[actor].paused = false; return rows[actor]; });
      return s ? journeyInput_(s) : jobMessage_('目前使用人數較多，請稍後再試。');
    }
    if (!s) return explicit ? jobMessage_('目前沒有有效職缺。先貼職缺，或沿用舊版資料，即可接著完成三題訪談。', [['貼職缺', 'jg:start'], ['沿用舊版職缺', 'jg:legacy']]) : null;
    if (command && s.id !== command[2]) return jobMessage_('這張卡片屬於舊職缺，未改動目前資料。', [['繼續這份職缺', 'jg:resume']]);
    if ((s.events || []).indexOf(eventKey_(event)) >= 0) return journeySafeRender_(s, cfg);
    if (s.busyUntil > Date.now() && !(command && ['leave', 'job', 'delete'].indexOf(command[1]) >= 0)) return jobMessage_('AI 正在整理這份職缺，請稍候再開啟；不需要重新貼上。', [['繼續這份職缺', 'jg:resume']]);
    if (resume) { s = guideChange_(user, cfg, function (rows, actor) { rows[actor].paused = false; return rows[actor]; }); return journeySafeRender_(s, cfg); }
    if (command && command[1] === 'example') return jobMessage_('請參考格式貼上自己的完整職缺：\n\n職缺：AI工程師\n工作內容：使用 Python 開發 AI 應用，串接 API。\n必要條件：具備 Python 專案經驗。\n加分條件：使用過 Google Apps Script。', [['繼續這份職缺', 'jg:resume']]);
    if (command && command[1] === 'info') return jobMessage_('職缺、少量公開履歷片段及確認送出的補充回答會送至 Gemini。資料存於私人 Drive，各訪客分開存取，24 小時後不可查閱，後續使用時清理。補充內容不寫回公開履歷，不主動分享或通知他人。\n開啟邀約表單不會送出邀約，仍需另行確認。', [['繼續這份職缺', 'jg:resume']]);
    if (command && ['job', 'new'].indexOf(command[1]) >= 0) {
      s = guideChange_(user, cfg, function (rows, actor) { rows[actor].awaitingReplacement = true; delete rows[actor].pendingJob; delete rows[actor].lease; delete rows[actor].busyUntil; journeyRemember_(rows[actor], event); return rows[actor]; });
      return journeyRender_(s);
    }
    if (command && command[1] === 'keep') { s = guideChange_(user, cfg, function (rows, actor) { delete rows[actor].awaitingReplacement; delete rows[actor].pendingJob; journeyRemember_(rows[actor], event); return rows[actor]; }); return journeySafeRender_(s, cfg); }
    if (command && command[1] === 'replace') {
      if (!s.pendingJob || command[3] !== sha256_(s.pendingJob).slice(0, 12)) return journeyRender_(s);
      s = guideChange_(user, cfg, function (rows, actor) { var row = rows[actor];
        if (!row || row.id !== command[2] || !row.pendingJob || sha256_(row.pendingJob).slice(0, 12) !== command[3]) return null;
        var fresh = journeyNew_(row); fresh.job = row.pendingJob; fresh.stage = 'extract'; journeyRemember_(fresh, event); rows[actor] = fresh; return fresh; });
      if (!s) return jobMessage_('職缺已變更，請重新確認目前內容。', [['我的職缺', 'jg:resume']]);
      startLoading_(user, cfg); return journeyRun_(event, cfg, s.id, 'extract');
    }
    if (command && command[1] === 'options') return jobMessage_('這份職缺的設定', [['查看原職缺', 'jg:jobtext:' + s.id], ['更換職缺', 'jg:job:' + s.id],
      ['資料使用說明', 'jg:info:' + s.id], ['查看前次回答', 'jg:previous:' + s.id], ['刪除這份職缺', 'jg:delete:' + s.id], ['回到原步驟', 'jg:resume']]);
    if (command && command[1] === 'jobtext') return jobMessage_(s.job || '尚未貼上職缺。', journeyActions_(s));
    if (command && command[1] === 'delete') return jobMessage_('要刪除這份職缺、證據與三題回答嗎？此操作無法復原，已傳出的訊息無法收回。', [['確認刪除', 'jg:deleteyes:' + s.id], ['保留，繼續', 'jg:resume']]);
    if (command && command[1] === 'deleteyes') { var removed = guideChange_(user, cfg, function (rows, actor) {
      if (!rows[actor] || rows[actor].id !== command[2]) return false; delete rows[actor]; return true;
    }); return jobMessage_(removed ? '已刪除這份職缺。' : '職缺已變更，沒有刪除目前資料。', [['貼新職缺', 'jg:start']]); }
    if (command && command[1] === 'leave') { guideChange_(user, cfg, function (rows, actor) { rows[actor].paused = true; delete rows[actor].lease; delete rows[actor].busyUntil; }); return jobMessage_('已暫停，職缺與回答保留在原步驟。', [['繼續這份職缺', 'jg:resume']]); }
    if (command && command[1] === 'conditions') return jobMessage_('移除不想比對的條件，至少保留一項。', s.requirements.map(function (r, i) { return ['移除第 ' + (i + 1) + ' 項', 'jg:remove:' + s.id + ':' + r.id]; }).concat([['完成調整', 'jg:resume']]));
    if (command && command[1] === 'remove' && s.stage === 'review') { s = guideChange_(user, cfg, function (rows, actor) { var row = rows[actor]; if (row.requirements.length > 1) row.requirements = row.requirements.filter(function (r) { return r.id !== command[3]; }); return row; }); return journeyReview_(s); }
    if (command && command[1] === 'extract') return journeyRun_(event, cfg, s.id, 'extract');
    if (command && ['compare', 'next'].indexOf(command[1]) >= 0) {
      // 同一來源重按不重做；來源變更時保留前次回答後重新比對。
      if (s.fingerprint) {
        var current = guideSource_(cfg);
        if (current.source.fingerprint !== s.fingerprint) s = guideChange_(user, cfg, function (rows, actor) { rows[actor].stage = 'analysis'; return rows[actor]; });
      }
      startLoading_(user, cfg); return journeyRun_(event, cfg, s.id, 'compare');
    }
    if (command && command[1] === 'edit' && s.interview && ['reviewAnswers', 'complete'].indexOf(s.stage) >= 0) {
      var index = s.interview.questions.findIndex(function (q) { return q.id === command[3]; });
      if (index < 0) return journeySafeRender_(s, cfg);
      guideSource_(cfg, s.fingerprint);
      s = guideChange_(user, cfg, function (rows, actor) { var row = rows[actor]; row.interview.cursor = index; row.interview.answers[index] = null; row.interview.revision++; delete row.interview.followups; delete row.interview.confirmed; row.stage = 'interview'; row.paused = false; journeyRemember_(row, event); return row; });
      return journeyPrompt_(s);
    }
    if (command && command[1] === 'finalize') return journeyRun_(event, cfg, s.id, 'finalize', command[3]);
    if (command && command[1] === 'invite') {
      guideChange_(user, cfg, function (rows, actor) { rows[actor].paused = true; delete rows[actor].lease; delete rows[actor].busyUntil; });
      return startJobInvitation_(event, s, cfg);
    }
    if (command && ['answers', 'previous'].indexOf(command[1]) >= 0) {
      var interview = command[1] === 'previous' ? s.previousInterview : s.interview;
      return interview ? journeyTextMessages_(journeyAnswersText_({ interview: interview }),
        s.interview && command[1] === 'answers' && s.stage === 'complete' ? s.interview.questions.map(function (q, i) { return ['修改第 ' + (i + 1) + ' 題', 'jg:edit:' + s.id + ':' + q.id]; }).concat([['返回結果', 'jg:resume']]) : [['回到原步驟', 'jg:resume']]) : jobMessage_('這份職缺尚無該項回答。', [['繼續這份職缺', 'jg:resume']]);
    }
    if (command && ['summary', 'report', 'questions', 'evidence', 'works'].indexOf(command[1]) >= 0) {
      if (!s.fingerprint) return journeyRender_(s);
      guideSource_(cfg, s.fingerprint);
      if (command[1] === 'questions') return s.stage === 'complete' ? journeyTextMessages_(journeyFollowupsText_(s), journeyActions_(s)) : jobMessage_('先完成這份職缺的三題訪談並確認回答，才會產生正式面試追問。', [['繼續訪談', 'jg:resume']]);
      if (command[1] === 'report') return s.stage === 'complete' ? journeyReport_(s) : journeySafeRender_(s, cfg);
      if (command[1] === 'summary') return journeySafeRender_(s, cfg);
      if (!s.fingerprint) return journeySafeRender_(s, cfg);
      var prepared = guideSource_(cfg, s.fingerprint), citations = [].concat.apply([], Object.keys(s.results).map(function (key) { return s.results[key].evidence; }));
      var keys = (prepared.index.imageSources || []).filter(function (image) { return citations.some(function (e) { return e.imageKey === image.imageKey || !e.imageKey && portfolioTitle_(e.section) === portfolioTitle_(image.section); }); }).map(function (image) { return image.imageKey; });
      var entries = portfolioEntries_(prepared.index, prepared.source, cfg, keys).filter(function (entry) { return citations.some(function (e) { return e.imageKey === entry.imageKey || !e.imageKey && portfolioTitle_(e.section) === entry.title; }); });
      guideSource_(cfg, s.fingerprint);
      var messages = journeyTextMessages_('【這份職缺的公開證據】\n' + journeyEvidenceText_(s), journeyActions_(s)), card = portfolioMessage_(entries.slice(0, 3));
      if (card && messages.length < 5) messages.splice(messages.length - 1, 0, card);
      if (!card) messages[messages.length - 1].text = '這份職缺目前沒有對應的已開放作品圖片；上方仍可查看文字證據。\n可繼續操作這份職缺：';
      return messages;
    }
    if ((s.events || []).indexOf(eventKey_(event)) >= 0) return journeySafeRender_(s, cfg);
    if (explicit && !(command && command[1] === 'skip')) return journeySafeRender_(s, cfg);
    if (event.type === 'message' && text && (s.stage === 'input' || s.awaitingReplacement || s.stage === 'review' || s.stage === 'extract')) {
      if (text.length < 20 || text.length > 4000 || /^https?:\/\/\S+$/.test(text) || !/[\n。；;：:]/.test(text)) return jobMessage_('請貼完整職缺（20～4000 字），包括工作內容與條件；不能只有職稱或網址。', [['看範例', 'jg:example:' + s.id]]);
      if (s.job) { s = guideChange_(user, cfg, function (rows, actor) { rows[actor].pendingJob = text; journeyRemember_(rows[actor], event); return rows[actor]; }); return journeyRender_(s); }
      s = guideChange_(user, cfg, function (rows, actor) { var row = rows[actor]; row.job = text; row.stage = 'extract'; journeyRemember_(row, event); return row; });
      startLoading_(user, cfg); return journeyRun_(event, cfg, s.id, 'extract');
    }
    if (s.stage === 'interview' && (event.type === 'message' && text || command && command[1] === 'skip')) {
      guideSource_(cfg, s.fingerprint);
      if (command && command[3] !== journeyToken_(s)) return journeyPrompt_(s);
      if (!command && text.length > 800) return jobMessage_('每題最多 800 字，請縮短後重送；這題尚未保存。', [['繼續這題', 'jg:resume']]);
      s = guideChange_(user, cfg, function (rows, actor) {
        var row = rows[actor]; if (!row || row.id !== s.id || (row.events || []).indexOf(eventKey_(event)) >= 0 || row.stage !== 'interview' || row.interview.id !== s.interview.id || row.interview.revision !== s.interview.revision) return row;
        row.interview.answers[row.interview.cursor] = command || /^(略過|跳過)$/.test(text) ? '略過，待面試確認' : text;
        row.interview.revision++; var next = row.interview.answers.findIndex(function (answer) { return answer === null; });
        row.stage = next < 0 ? 'reviewAnswers' : 'interview'; if (next >= 0) row.interview.cursor = next;
        journeyRemember_(row, event); return row;
      });
      return journeySafeRender_(s, cfg);
    }
    return journeySafeRender_(s, cfg);
  } catch (error) { safeLog_('JOB_JOURNEY_' + errorCode_(error)); return journeyError_(error, s); }
}
