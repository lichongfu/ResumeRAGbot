/**
 * 舊版職缺補充訪談相容程式：candidate.6 起不再由 LINE 路由呼叫。
 * 保留舊資料格式與回歸檢查，現行主流程使用 JobGuide／JobJourney。
 * 舊版私有 Drive 保存七天；職缺與回答不寫回 Doc、不送模型。
 * 三題採透明的固定框架，引用人資選定的條件；結果是本人陳述，不是能力評分。
 */
/** 測試角色只綁定已設定的本人、目前 Doc 與兩小時期限。 */
function jobRoleKey_(cfg) { return 'JOB_TEST_ROLE_' + sha256_(cfg.docId).slice(0, 16); }
function jobRoleState_(user, cfg) {
  if (!user || user !== ownerLineUserId_()) return { role: 'recruiter' };
  var value;
  try { value = JSON.parse(PropertiesService.getScriptProperties().getProperty(jobRoleKey_(cfg)) || 'null'); } catch (_) {}
  if (value && value.owner === invitationVisitor_(user) && value.expiresAt > Date.now() &&
      ['recruiter', 'applicant'].indexOf(value.role) >= 0) return { role: value.role, testing: true };
  return { role: 'applicant', expired: !!value };
}
function jobInterviewActions_(user, cfg) {
  var state = jobRoleState_(user, cfg), actions = state.role === 'applicant' ?
    [contactButton_('待回答職缺', 'jm:list')] :
    [contactButton_('選配：請本人補充三題', 'jm:start'), contactButton_('查看回覆與面試問題', 'jm:list')];
  if (user && user === ownerLineUserId_()) {
    actions.push(contactButton_(state.role === 'recruiter' ? '切換為應徵者（測試）' : '模擬人資（本人測試）',
      state.role === 'recruiter' ? 'jm:role:applicant' : 'jm:role:recruiter'));
    if (state.testing) actions.push(contactButton_('結束測試', 'jm:role:exit'));
  }
  return actions;
}
function jobHomeActions_(user, cfg) {
  return [contactButton_('我的職缺與訪談', 'jg:resume')];
}

function jobMessage_(text, actions) {
  var message = textMessage_(text);
  delete message.quickReply;
  if (actions && actions.length) message.quickReply = { items: actions.map(function (a) {
    return { type: 'action', action: { type: 'postback', label: a[0], data: a[1], displayText: a[0] } };
  }) };
  return [message];
}

function jobQuestions_(focus) {
  return ['針對「' + focus + '」，請舉一個最相關的經驗，說明你本人負責的工作。',
    '在上述經驗中，你遇到什麼困難？如何處理，以及如何確認結果？',
    '針對這份職缺，你希望負責哪些工作？有哪些需要學習，或希望公司提供的支持？'];
}

function jobPreview_(r) {
  return jobMessage_('分享前確認｜' + r.id + '\n重點條件：' + r.focus + '\n\n' +
    r.questions.map(function (q, i) { return (i + 1) + '. ' + q + '\n回答：' + r.answers[i]; }).join('\n\n') +
    '\n\n確認後，只有原提出需求的人資可在此 bot 查看。回答為本人陳述，尚未驗證。',
    [['確認分享', 'jm:share:' + r.id], ['重答三題', 'jm:restart:' + r.id], ['取消這份', 'jm:cancel:' + r.id]]);
}

function jobPrompt_(r) {
  var step = r.answers.length;
  return jobMessage_('職缺 ' + r.id + '｜第 ' + (step + 1) + ' / 3 題\n' + r.questions[step] +
    '\n\n每題最多 800 字。回答暫不分享，可略過、稍後繼續或取消。',
    [['略過這題', 'jm:skip:' + r.id + ':' + step], ['稍後回答', 'jm:pause:' + r.id], ['取消這份', 'jm:cancel:' + r.id]]);
}

function jobResult_(r) {
  var followups = [
    '針對第一題的經驗，請現場說明一個具體產出，以及你與其他成員各自的貢獻。',
    '針對第二題的處理方式，當時考慮過哪些替代方案？可用什麼資料或作品驗證結果？',
    '針對第三題的工作期待，雙方可提供哪些任務、學習時間與支持？請逐項確認。'];
  var summary = '職缺補充摘要｜' + r.id + '\n人資確認的重點：' + r.focus +
    '\n\n【應徵者補充，尚未驗證】\n' + r.questions.map(function (q, i) {
      return (i + 1) + '. ' + q + '\n' + r.answers[i];
    }).join('\n\n') + '\n\n【正式面試額外追問】\n' + followups.map(function (q, i) {
      return (i + 1) + '. ' + (r.answers[i] === '略過，待面談確認' ? '此題尚未回答，請先確認：' + r.questions[i] :
        '你先前提到「' + r.answers[i].slice(0, 100) + (r.answers[i].length > 100 ? '…' : '') + '」。' + q);
    }).join('\n') + '\n\n本摘要不代表履歷已驗證或面試已排定。可使用原有履歷問答查看公開證據；本流程未自動判定符合程度。';
  return jobMessage_(summary, [['查看原職缺', 'jm:job:' + r.id], ['刪除這份', 'jm:cancel:' + r.id]]);
}

/** 每個變更先保存結果，LINE 回覆失敗重送同一事件時不會吃掉下一題。 */
function handleJobMatch_(event, text, cfg) {
  var user = event.source.userId, owner = ownerLineUserId_(), role = jobRoleState_(user, cfg);
  var asApplicant = user === owner && role.role === 'applicant';
  var actor = invitationVisitor_(user === owner && role.testing && role.role === 'recruiter' ? user + ':job-test:' + cfg.docId : user);
  var roleCommand = /^(模擬人資|切回應徵者|結束測試)$/.test(text) ?
    { '模擬人資': 'recruiter', '切回應徵者': 'applicant', '結束測試': 'exit' }[text] :
    (/^jm:role:(recruiter|applicant|exit)$/.exec(text) || [])[1];
  var explicit = !!roleCommand || /^(jm:|職缺對照$|我的職缺$|待回答職缺$)/.test(text);
  // 邀約流程優先；回首頁可暫停，新的邀約不可被答案流程誤吃。
  var navigation = /^(?:首頁|選單|回首頁|nav:home|清除對話|重新開始|reset|聯繫本人|留下邀約)$/.test(text) ||
    /^(?:invite:|nav:contact|contact:|topic:|work:)/.test(text) || contactIntent_(text);
  var lock = LockService.getScriptLock(); lock.waitLock(5000);
  try {
    var store = loadPortfolioStore_(cfg), data = store.jobMatch || { records: {}, drafts: {}, receipts: {} }, now = Date.now();
    store.jobMatch = data;
    var expired = false;
    Object.keys(data.records).forEach(function (id) {
      var r = data.records[id];
      if (r.expiresAt <= now) { expired = true; delete data.records[id]; }
    });
    Object.keys(data.drafts).forEach(function (id) {
      if (data.drafts[id].expiresAt <= now) { if (id === actor) expired = true; delete data.drafts[id]; }
    });
    if (expired) data.receipts = {};
    Object.keys(data.receipts).forEach(function (id) { if (data.receipts[id].expiresAt <= now) delete data.receipts[id]; });
    var active = Object.keys(data.records).map(function (id) { return data.records[id]; }).find(function (r) {
      return asApplicant && (!!r.testOwner === !!role.testing) &&
        (!r.testOwner || r.testOwner === invitationVisitor_(user)) && (r.status === 'answering' || r.status === 'review');
    }), draft = data.drafts[actor];
    var receiptKey = actor + ':' + role.role + ':' + !!role.testing + ':' + eventKey_(event), old = data.receipts[receiptKey];
    if (old) return old.messages;
    if (!explicit && !active && !draft && !expired && !role.expired) return null;
    function done(messages) {
      data.receipts[receiptKey] = { messages: messages, expiresAt: now + 86400000 };
      var keys = Object.keys(data.receipts);
      while (keys.length > 150) delete data.receipts[keys.shift()];
      savePortfolioStore_(store, cfg);
      return messages;
    }
    if (roleCommand) {
      if (user !== owner) return done(jobMessage_('角色切換僅限已設定 LINE 通知的履歷本人使用。'));
      var invitation = invitationDraft_(invitationKey_(user, cfg));
      if (invitation && invitation.step < 5) return done(jobMessage_('請先完成或取消目前的邀約表單，再切換測試角色。職缺與邀約不會混用。'));
      // 保留未分享回答與人資草稿；切換不會自動分享或送出。
      Object.keys(data.records).forEach(function (id) {
        if (['answering', 'review'].indexOf(data.records[id].status) >= 0) data.records[id].status = 'paused';
      });
      data.receipts = {};
      savePortfolioStore_(store, cfg);
      var props = PropertiesService.getScriptProperties();
      if (roleCommand === 'exit') props.deleteProperty(jobRoleKey_(cfg));
      else props.setProperty(jobRoleKey_(cfg), JSON.stringify({ owner: invitationVisitor_(user), role: roleCommand, expiresAt: now + 7200000 }));
      return jobMessage_(roleCommand === 'exit' ? '已結束測試，回到應徵者本人。測試需求保留，可重新進入測試查看或刪除。' :
        '本人測試｜目前角色：' + (roleCommand === 'recruiter' ? '人資' : '應徵者') +
        '\n兩小時有效。測試需求與正式需求分開顯示；切換時保存草稿及回答，不自動分享。請點下方入口繼續。',
        jobInterviewActions_(user, cfg).map(function (button) { return [button.action.label, button.action.data]; }));
    }
    if (role.expired) {
      PropertiesService.getScriptProperties().deleteProperty(jobRoleKey_(cfg));
      return done(jobMessage_('本人測試已過期或設定已變更，已回到應徵者身分。剛才的輸入未當成回答，也未交給 AI。請重新輸入「模擬人資」開始測試，或輸入「首頁」。'));
    }
    if (text === 'jm:menu') return done(jobMessage_('選配：本人三題訪談\n此流程會通知履歷本人回答，需先設定 OWNER_LINE_USER_ID。本人測試可切換角色；主要的證據導覽與準備單不需要切換。',
      jobInterviewActions_(user, cfg).map(function (button) { return [button.action.label, button.action.data]; })));
    if (navigation) {
      if (active) active.status = 'paused';
      delete data.drafts[actor]; savePortfolioStore_(store, cfg); return null;
    }
    if (text === '取消' || text === 'jm:cancel-draft') {
      if (active) { delete data.records[active.id]; data.receipts = {}; }
      delete data.drafts[actor]; return done(jobMessage_('已取消目前填寫。未分享的回答不會提供給人資。'));
    }
    if (text === '職缺對照' || text === 'jm:start') {
      if (asApplicant) return done(jobMessage_('目前是應徵者角色。請切換「模擬人資」後貼職缺，或查看待回答需求。',
        [['模擬人資', 'jm:role:recruiter'], ['待回答職缺', 'jm:list']]));
      if (!owner) return done(jobMessage_('本人尚未設定 LINE 通知，暫時無法受理。可使用「聯繫本人」。'));
      if (Object.keys(data.drafts).length >= 30 && !draft) return done(jobMessage_('目前填寫人數較多，請稍後再試。'));
      data.drafts[actor] = { id: sha256_(Utilities.getUuid()).slice(0, 16), step: 'job', expiresAt: now + 1800000 };
      return done(jobMessage_('請貼上職缺文字（最多 4000 字，不接受只有網址）。\n\n確認送出後，職缺將保存於本人的私人 Drive，供本人回答三題。未送出草稿保留 30 分鐘；送出需求保留七天，到期後不可查閱，並於下次使用本流程時清除。不寫入履歷或交給 AI。請勿貼私人或機密資料。輸入「取消」離開。'));
    }
    if (text === '我的職缺' || text === '待回答職缺' || text === 'jm:list') {
      var rows = Object.keys(data.records).map(function (id) { return data.records[id]; }).filter(function (r) {
        return asApplicant ? (!!r.testOwner === !!role.testing && (!r.testOwner || r.testOwner === invitationVisitor_(user))) : r.visitor === actor;
      });
      rows = rows.reverse().slice(0, 10);
      return done(jobMessage_(rows.length ? '最近十筆職缺（七天有效；更多需求可由原通知編號開啟）\n' + rows.map(function (r) { return r.id + '｜' + r.focus + '｜' + r.status; }).join('\n') : '目前沒有職缺需求。',
        rows.slice(0, 10).map(function (r) { return [r.id.slice(0, 8), 'jm:view:' + r.id]; })));
    }
    var command = /^jm:(view|answer|share|restart|pause|cancel|job|skip|submit):([a-f0-9]{16})(?::([0-2]))?$/.exec(text);
    if (command && command[1] === 'submit') {
      if (!draft || draft.id !== command[2] || draft.step !== 'confirm') return done(jobMessage_('這份草稿已失效或尚未完成，請重新輸入「職缺對照」。'));
      if (!owner) return done(jobMessage_('本人目前未設定 LINE 通知，尚未送出。'));
      if (Object.keys(data.records).length >= 30) return done(jobMessage_('目前需求已滿，請稍後再試。'));
      var record = { id: draft.id, visitor: actor, job: draft.job, focus: draft.focus,
        questions: jobQuestions_(draft.focus), answers: [], status: 'waiting', expiresAt: now + 7 * 86400000,
        notification: { status: 'attempting', retryKey: Utilities.getUuid() } };
      if (user === owner && role.testing) record.testOwner = invitationVisitor_(user);
      data.records[record.id] = record; delete data.drafts[actor];
      // 先持久化送出結果；通知結果不明時不自動重寄。人資可以主動查詢，無須保存原始 LINE ID。
      var response = done(jobMessage_('需求已保存，編號 ' + record.id + '。通知結果請查看狀態；不代表本人已讀。\n請稍後輸入「我的職缺」查看回答，系統不會主動推送回答給你。', [['查看狀態', 'jm:view:' + record.id]]));
      record.notification = Object.assign(record.notification, sendOwnerLineText_(owner,
        (record.testOwner ? '【本人測試】請先輸入「切回應徵者」。\n' : '') + '收到職缺補充需求｜' + record.id + '\n重點條件：' + record.focus + '\n\n請輸入「待回答職缺」，選擇此編號並查看職缺，再開始依序回答三題。回答需經你確認才分享。七天有效。', cfg, record.notification.retryKey));
      savePortfolioStore_(store, cfg); return response;
    }
    if (command) {
      var action = command[1], r = data.records[command[2]], isOwner = asApplicant && r &&
        (!!r.testOwner === !!role.testing) && (!r.testOwner || r.testOwner === invitationVisitor_(user));
      if (!r || !isOwner && r.visitor !== actor) return done(jobMessage_('找不到可存取的需求，可能已刪除或過期。'));
      if (action === 'cancel') { delete data.records[r.id]; data.receipts = {}; return done(jobMessage_('已刪除這份職缺與回答。對方先前已看過或保存的內容無法收回。')); }
      if (action === 'job') return done(jobMessage_('原職缺｜' + r.id + '\n' + r.job, [['返回', 'jm:view:' + r.id]]));
      if (action === 'view') {
        if (r.status === 'shared') return done(jobResult_(r));
        if (isOwner) return done(jobMessage_('職缺 ' + r.id + '\n重點：' + r.focus + '\n\n' + r.job,
          [['開始／繼續回答', 'jm:answer:' + r.id], ['取消這份', 'jm:cancel:' + r.id]]));
        return done(jobMessage_('本人尚未確認分享回答。\n通知狀態：' + r.notification.status + '（sent 表示平台接受，不代表已讀）', [['重新查詢', 'jm:view:' + r.id], ['取消需求', 'jm:cancel:' + r.id]]));
      }
      if (!isOwner) return done(jobMessage_('此操作僅限履歷本人，回答尚未分享。'));
      if (r.status === 'shared') return done(jobMessage_('此份已分享。若要重新補充，請人資另建需求，避免改動已分享的版本。'));
      if (action === 'answer' || action === 'restart') {
        if (active && active.id !== r.id) active.status = 'paused';
        if (action === 'restart') r.answers = [];
        r.status = r.answers.length === 3 ? 'review' : 'answering';
        return done(r.status === 'review' ? jobPreview_(r) : jobPrompt_(r));
      }
      if (action === 'pause') { r.status = 'paused'; return done(jobMessage_('已暫存，輸入「待回答職缺」可繼續。')); }
      if (action === 'share' && r.answers.length === 3 && r.status === 'review') {
        r.status = 'shared'; return done(jobMessage_('已確認分享，人資可從「我的職缺」查看三題回答及面試追問。'));
      }
      if (action === 'skip' && r.status === 'answering' && Number(command[3]) === r.answers.length) {
        r.answers.push('略過，待面談確認'); r.status = r.answers.length === 3 ? 'review' : 'answering';
        return done(r.status === 'review' ? jobPreview_(r) : jobPrompt_(r));
      }
      return done(jobMessage_('此操作已失效，請重新開啟這份需求。', [['重新開啟', 'jm:view:' + r.id]]));
    }
    if (/^jm:/.test(text)) return done(jobMessage_('操作已失效，請輸入「我的職缺」或「待回答職缺」。'));
    if (event.type !== 'message' || !text) return done(jobMessage_('請輸入文字，或使用目前流程的按鈕。'));
    if (draft) {
      if (draft.step === 'job') {
        if (text.length > 4000 || /^https?:\/\/\S+$/.test(text)) return done(jobMessage_('請貼完整職缺文字，最多 4000 字；不會自動讀取網址，也不會截斷內容。'));
        draft.job = text; draft.step = 'focus';
        return done(jobMessage_('請從剛才的職缺原文，複製一項最想確認的條件或工作任務（最多 200 字）。\n系統不會自行把加分條件升為必要條件。'));
      }
      if (draft.step === 'focus') {
        if (text.length > 200 || draft.job.indexOf(text) < 0) return done(jobMessage_('請直接複製職缺原文中的一項條件，最多 200 字。'));
        draft.focus = text; draft.step = 'confirm';
      }
      return done(jobMessage_('確認送出職缺\n' + draft.job + '\n\n重點條件：' + draft.focus +
        '\n\n確認後保存七天並通知本人，使用三題框架蒐集相關經驗、處理方式與工作期待。', [['確認送出', 'jm:submit:' + draft.id], ['取消', 'jm:cancel-draft']]));
    }
    if (active) {
      if (active.answers.length === 3) return done(jobPreview_(active));
      if (text.length > 800) return done(jobMessage_('此題最多 800 字，請縮短後重送；目前回答尚未保存。'));
      active.answers.push(text); active.status = active.answers.length === 3 ? 'review' : 'answering';
      return done(active.status === 'review' ? jobPreview_(active) : jobPrompt_(active));
    }
    return done(jobMessage_('填寫已暫停或過期，請輸入「我的職缺」或「待回答職缺」重新選擇。'));
  } catch (error) {
    safeLog_('JOB_MATCH_STORAGE_FAILED');
    return jobMessage_('職缺流程暫時無法完成。請保留剛才輸入，稍後重新查看狀態；目前不保證變更已保存。');
  } finally { lock.releaseLock(); }
}
