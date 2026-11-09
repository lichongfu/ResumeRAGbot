/**
 * 【LINE 顯示與訊息傳送】
 * 本檔只負責將資料組成文字、貼圖與 Flex 首頁，以及呼叫 LINE API。
 * Quick Reply 使用同步後的同一份代表主題；操作指令不混入代表關鍵字。
 */

/**
 * 固定兩個基本入口，加上本次有效的適性主題；不在聊天時重新分類。
 */
function quickReply_() {
  return { items: visibleMenuTopics_().map(function (topic) {
    return { type: 'action', action: { type: 'postback', label: topic.label, data: 'topic:' + topic.id, displayText: topic.label } };
  }) };
}

var LINE_STICKERS_ = {
  celebrate: { packageId: '11537', stickerId: '52002734' }, // 熊大慶祝（適合專案成果、代表作品、亮點成就）
  greet:     { packageId: '11537', stickerId: '52002738' }, // 兔兔與莎莉探頭招呼：開始認識
  thanks:    { packageId: '11537', stickerId: '52002739' }, // 熊大感謝（適合聯絡方式、作品連結、期待合作）
  confident: { packageId: '11537', stickerId: '52002735' }, // 兔兔比讚：有履歷依據的能力肯定，不承諾錄取或勝任
  interested:{ packageId: '11537', stickerId: '52002752' }, // 兔兔期待：回應明確表達的關注，不推定已決定合作
  attentive: { packageId: '11537', stickerId: '52002768' }, // 兔兔探頭聆聽：願意釐清，不用問號嘲弄訪客
  received:  { packageId: '11537', stickerId: '52002740' }, // 兔兔 OK：只表示已保存邀約，不代表面試已排定
  energetic: { packageId: '11537', stickerId: '52002741' }, // 莎莉跳躍（適合學歷學習、工作態度、求職熱忱）
  confused:  { packageId: '11537', stickerId: '52002744' }, // 熊大問號（適合履歷資料不足、待確認補充問題）
  happy:     { packageId: '11537', stickerId: '52002745' }  // 兔兔開心（適合一般正向熱絡交流）
};

/**
 * 從固定允許清單選貼圖，模型不能自行指定任意貼圖 ID。
 */
function stickerMessage_(mood) {
  var sticker = LINE_STICKERS_[mood];
  return sticker ? { type: 'sticker', packageId: sticker.packageId, stickerId: sticker.stickerId, quickReply: quickReply_() } : null;
}

/**
 * 貼圖表達交流目的，不猜測訪客內心。優先採取可觀察的文字訊號，再使用回答模型的意圖。
 * 技術細節、資料不足、服務錯誤或未提供關鍵條件時，留白比不相稱的表情更清楚。
 */
function dialogueStickerIntent_(text, conversation) {
  if (conversation && conversation.answerStatus === 'clarification') return 'clarification';
  if (!conversation || conversation.answerStatus !== 'answered') return 'neutral';
  var request = conversation.request || {}, answer = conversation.messages[0] && conversation.messages[0].text || '';
  if (/不太懂|看不懂|不懂|不明白|不確定|擔心|疑慮|真的嗎|確定嗎|怎麼證明|說明一下/.test(text)) return 'clarification';
  if (request.answerMode === 'intro') return 'introduction';
  if (/配色|構圖|色碼|哪個欄位|什麼欄位|用什麼技術|哪個套件|哪個函式|怎麼計算|如何計算|程式碼/.test(text)) return 'neutral';
  if (/尚未提供|未提供|無法確認|未記載|不符合|不具備|沒有相關經驗/.test(answer)) return 'neutral';
  if (/勝任|適合|符合|匹配|能力|擅長/.test(text)) return 'capability';
  if (/成果|成效|改善|節省|省了|縮短|提升/.test(text) && /\d|提升|縮短|節省|改善/.test(answer)) return 'achievement';
  return ['introduction', 'capability', 'achievement', 'interest', 'appreciation', 'clarification'].indexOf(conversation.dialogueIntent) >= 0 ? conversation.dialogueIntent : 'neutral';
}

/** 明確的簡短社交訊息不必向量搜尋，也不記成履歷缺漏；邀約草稿仍由 Contact 先處理。 */
function socialDialogue_(text, cfg, prepared) {
  if (/^(?:你好|您好|嗨|哈囉|哈啰|hello|hi)[！!。～~\s]*$/i.test(text)) return {
    intent: 'introduction', messages: [textMessage_('你好！可以從「我是誰」或「快速一覽」開始，也能直接問你感興趣的經歷與作品。')] };
  if (/^(?:謝謝(?:你|您|啦)?|多謝|感謝(?:你|您)?|了解了[，,]?謝謝|明白了[，,]?謝謝|thank you|thanks)[！!。～~\s]*$/i.test(text)) return {
    intent: 'appreciation', messages: [textMessage_('謝謝你的交流！有想深入了解的部分，隨時可以繼續問。')] };
  if (/^(?:(?:我|我們)?(?:覺得|看起來)?(?:不錯|很有意思|挺有意思)|(?:我|我們)?(?:很|蠻|滿|非常)?有興趣|(?:我|我們)?想進一步了解)[！!。～~\s]*$/.test(text)) return {
    intent: 'interest', messages: [textMessage_('謝謝你的關注！可以繼續看看經歷與作品；想進一步聊聊時，也可以使用「聯繫本人」。'), contactMessage_(cfg, prepared)] };
  return null;
}

function stickerHistoryKey_(userId) { return 'dialogue-sticker:' + sha256_(ScriptApp.getScriptId() + ':' + userId); }

/** 同一訪客 10 分鐘內不重複相同意圖；每次最多一張，不擠掉卡片或超過 LINE 五則上限。 */
function contextualSticker_(messages, intent, userId) {
  var moods = { introduction: 'greet', capability: 'confident', achievement: 'celebrate', interest: 'interested',
    appreciation: 'thanks', clarification: 'attentive', contact: 'thanks', invitation_received: 'received' };
  var mood = moods[intent];
  if (!mood || messages.length >= 5 || messages.some(function (message) { return message.type === 'sticker'; })) return null;
  try {
    var history = JSON.parse(CacheService.getScriptCache().get(stickerHistoryKey_(userId)) || 'null');
    if (history && history[intent] > Date.now() - 600000) return null;
  } catch (_) { return null; }
  return stickerMessage_(mood);
}

/** 只有 LINE 回覆成功才記錄貼圖使用時間，傳送失敗可安全重試，不保存訊息正文或 userId。 */
function rememberDialogueSticker_(intent, userId) {
  try {
    var cache = CacheService.getScriptCache(), key = stickerHistoryKey_(userId), history = JSON.parse(cache.get(key) || '{}');
    Object.keys(history).forEach(function (name) { if (history[name] <= Date.now() - 600000) delete history[name]; });
    history[intent] = Date.now(); cache.put(key, JSON.stringify(history), 600);
  } catch (_) { safeLog_('DIALOGUE_STICKER_CACHE_UNAVAILABLE'); }
}

/**
 * 建立 LINE 文字訊息，並附上相同的代表主題 Quick Reply。
 */
function textMessage_(text) {
  return { type: 'text', text: Array.from(String(text)).slice(0, 4500).join(''), quickReply: quickReply_() };
}

/**
 * 無肖像時以 LINE 原生幾何元件畫出親和人物，不使用姓名首字或生成真人照片。
 * 圖形只存在於訊息中：不用讀外部圖片、不呼叫 AI，更不寫入 Google Doc。
 */
function friendlyAvatar_() {
  function shape(width, height, left, top, color, radius, contents) {
    return { type: 'box', layout: 'vertical', position: 'absolute', width: width + 'px', height: height + 'px',
      offsetStart: left + 'px', offsetTop: top + 'px', backgroundColor: color, cornerRadius: radius + 'px', contents: contents || [] };
  }
  return { type: 'box', layout: 'vertical', width: '80px', height: '80px', cornerRadius: '40px', backgroundColor: '#E6EFE6', contents: [
    shape(56, 34, 12, 48, '#377E6B', 28),
    shape(12, 16, 34, 38, '#E6B989', 6),
    shape(34, 36, 23, 13, '#F1CCA2', 17, [
      shape(34, 12, 0, 0, '#3D5149', 8),
      shape(3, 3, 9, 17, '#3D5149', 2), shape(3, 3, 22, 17, '#3D5149', 2),
      shape(12, 9, 11, 22, '#8D5944', 6), shape(14, 6, 10, 20, '#F1CCA2', 3)
    ])
  ] };
}

/**
 * 首頁與 Quick Reply 沿用相同順序：我是誰、快速一覽、同步產生的適性主題。
 */
function welcomeMessage_(cfg, prepared, userId) {
  var buttons = visibleMenuTopics_(), profile = {}, portrait = null;
  // 新舊索引不符時，不能把已從文件刪掉的個資繼續顯示在首頁。
  if (prepared && prepared.index && prepared.source && prepared.index.fingerprint === prepared.source.fingerprint) {
    profile = validateHomeProfile_(prepared.index.quickTopics && prepared.index.quickTopics.homeProfile, prepared.index.chunks);
    try { portrait = portfolioEntries_(prepared.index, prepared.source, cfg, null, 'portrait')[0]; } catch (_) {}
  }
  var name = profile.name || cfg.name, role = profile.role || '歡迎認識我的經歷與作品';
  function text(value, size, color, bold) {
    return { type: 'text', text: value, size: size, color: color, weight: bold ? 'bold' : 'regular', wrap: true };
  }
  function action(topic) { return { type: 'postback', label: topic.label, data: 'topic:' + topic.id, displayText: topic.label }; }
  function card(number, title, contents, footer) {
    footer.forEach(function (button) {
      if (button.type === 'button') { button.style = button.action.data === 'jg:start' ? 'primary' : 'link'; button.color = '#23735B'; }
    });
    return { type: 'bubble', size: 'kilo', header: { type: 'box', layout: 'horizontal', paddingAll: '16px', backgroundColor: '#143D35', contents: [
      text(title, 'xs', '#FFFFFF', true), { type: 'text', text: number + ' / 03', align: 'end', size: 'xxs', color: '#B7D8C9', flex: 0 }
    ] }, body: { type: 'box', layout: 'vertical', paddingAll: '18px', spacing: 'md', height: '300px', backgroundColor: '#FAFBF8', contents: contents },
      footer: { type: 'box', layout: 'vertical', height: '184px', justifyContent: 'flex-end', spacing: 'xs', paddingAll: '12px', backgroundColor: '#FAFBF8', contents: footer } };
  }
  var identity = [portrait ? { type: 'box', layout: 'vertical', width: '80px', height: '80px', cornerRadius: '40px', alignItems: 'center', contents: [
    { type: 'image', url: portrait.imageUrl, size: 'full', aspectRatio: '1:1', aspectMode: 'cover' }
  ] } : friendlyAvatar_(), text(Array.from(name).slice(0,24).join(''), 'lg', '#143D35', true), text(role, 'xs', '#53635E', false)];
  var contacts = profile.contacts || [];
  identity.push({ type: 'separator', color: '#DDE6DF', margin: 'md' });
  // 聯繫資料逐字顯示，避免把範例地址變成貌似可用的寄信按鈕。
  (contacts.length ? contacts : ['尚未提供公開聯繫方式']).forEach(function (contact) { identity.push(text(contact, 'xxs', '#53635E', false)); });
  var traits = [text('一起工作時的我', 'lg', '#143D35', true)];
  (profile.traits && profile.traits.length ? profile.traits : ['可以先從經歷與作品認識我。']).forEach(function (trait, i) {
    traits.push({ type: 'box', layout: 'horizontal', spacing: 'md', margin: 'md', contents: [
      { type: 'text', text: '0' + (i + 1), size: 'xs', color: '#A18150', flex: 0 }, text(trait, 'sm', '#31483D', false)
    ] });
  });
  var navigation = [text('從這裡開始', 'lg', '#143D35', true), text('先認識我，再探索你感興趣的領域。', 'xs', '#687770', false)];
  // 與 Quick Reply 完全同源、同序；2 欄最多 3 列，長標籤可換行。
  for (var i = 0; i < buttons.length; i += 2) {
    navigation.push({ type: 'box', layout: 'horizontal', spacing: 'sm', contents: buttons.slice(i, i + 2).map(function (topic) {
      return { type: 'box', layout: 'vertical', flex: 1, height: '55px', paddingAll: '8px', cornerRadius: '10px',
        backgroundColor: topic.kind === 'adaptive' ? '#E8EFE9' : '#23735B', justifyContent: 'center', action: action(topic), contents: [
          { type: 'text', text: topic.label, size: 'xs', align: 'center', color: topic.kind === 'adaptive' ? '#143D35' : '#FFFFFF', weight: 'bold', wrap: true }
        ] };
    }) });
  }
  var compactButton = function (topic) { return { type: 'button', height: 'sm', style: 'link', color: '#23735B', action: action(topic) }; };
  return { type: 'flex', altText: Array.from(name).slice(0,50).join('') + '｜認識我・個人特質・履歷導覽', quickReply: quickReply_(), contents: { type: 'carousel', contents: [
    card('01', 'HELLO / 認識我', identity, [contactButton_('看履歷', 'topic:' + buttons[1].id),
      contactButton_('貼職缺', 'jg:start'), contactButton_('聯繫邀約', 'nav:contact')]),
    card('02', 'ABOUT / 個人特質', traits, [compactButton(buttons[1])]),
    card('03', 'EXPLORE / 履歷導覽', navigation, jobHomeActions_(userId, cfg))
  ] } };
}

/**
 * 訪客輸入「使用說明」時顯示的操作方法。
 */
function helpText_() {
  return "從「首頁」開始：\n• 看履歷：概覽經歷、技能與作品，也能自由提問。\n• 貼職缺：貼完整職缺 → 確認條件 → AI 比對並問三題 → 確認回答 → 查看整合結果。\n• 聯繫邀約：查看聯絡方式或留下邀約，確認後才送出。\n\n人資也可進入「招募工作台」貼多份已獲授權的履歷，查看熱圖、原文與資料覆蓋排序；數字不是能力分數。\n輸入「預約面談」選時段，本人可輸入「管理面談時段」設定。邀約會預填職缺摘要，確認後才送出。\n\n「我的職缺與訪談」會回到同一份職缺的原步驟，不需要切換角色，也不需重貼。三題由 AI 依職缺與履歷缺口生成，一次問一題；可略過、暫停或修改。確認後再產生正式面試的深入追問。\n\n輸入「取消」會暫停並保留職缺；刪除請到「職缺設定」。更換職缺前會再次確認。舊版的「待回答職缺」及角色按鈕會帶回目前職缺。\n\n作品可接續追問，短期記憶約 10 分鐘；輸入「清除對話」可重設。輸入「隱私」查看資料用途。";
}

/**
 * 向訪客說明提問、短期記憶與待補充問題的資料使用方式。
 */
function privacyText_() {
  return "我是 AI 履歷助理，重要資訊請向本人查證。\n\n資料使用方式：\n• 招募工作台的候選文字會交給 Gemini 找引文，與職缺一起到期（最長 24 小時）。一般 LINE 訪客彼此隔離；檔案實際在 bot 主人的 Drive，持有人仍可讀取。人工決定與理由不送 AI。\n• 面談時段選擇先暫留五分鐘，確認邀約後才登記預約。僅管理本 bot，不同步外部行事曆；預約在結束三十天後於後續操作時清理。取消預約不自動寄取消通知。\n• 職缺流程：職缺及少量公開履歷片段交由 Gemini 比對與出題。每題回答先存於私人準備單；三題完成、確認送出後，才交給 Gemini 產生正式面試追問。回答標示為填寫者補充，不自動變成履歷事實，不寫回 Doc 或索引，不自動分享、寄信或推播。\n• 各訪客以專案及 Doc 綁定的雜湊隔離，私人 Drive 保存 24 小時；到期後不可查閱，後續使用時清理，沒有背景清理排程。回首頁或取消是暫停；職缺設定中可確認刪除。已傳出的 LINE 訊息或自行複製的內容無法收回。\n• 舊版訪談資料保留於原私人資料檔，不自動轉成新證據；只有有權限的帳號可沿用尚未過期的職缺。\n• 邀約表單不交給 AI，確認後才保存至私人收件匣，並依設定以 Email、LINE 通知本人。\n• 一般問答只用公開區內容，提問與檢索片段會送至 Gemini；找不到答案時可能將問題寫入 Doc 的待補充區，不附訪客 LINE ID。\n• 作品預覽只用本人已開放的獨立圖片副本。短期對話記憶約 10 分鐘，事件以雜湊去重；不保存訪客原始 LINE ID，主人通知則使用已設定的 OWNER_LINE_USER_ID。\n\n請勿傳送密碼、證件或機密資料。LINE 與 Google 仍適用各自資料政策。";
}

/**
 * 先要求 LINE 顯示處理中動畫；動畫失敗不能阻止正常回答。
 */
function startLoading_(userId, cfg) {
  // 動畫失敗仍繼續回答，也不會為動畫先用掉 replyToken。
  try {
    requireValue_(cfg.lineToken, 'LINE_CHANNEL_ACCESS_TOKEN');
    var response = UrlFetchApp.fetch('https://api.line.me/v2/bot/chat/loading/start', {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + cfg.lineToken },
      payload: JSON.stringify({ chatId: userId, loadingSeconds: 60 }), muteHttpExceptions: true
    });
    var status = response.getResponseCode();
    if (status >= 200 && status < 300) return true;
    safeLog_('LINE_LOADING_HTTP_' + status);
  } catch (_) { safeLog_('LINE_LOADING_FAILED'); }
  return false;
}

/**
 * 使用本次 replyToken 回覆一次，最多五則訊息。
 * Token 被拒時不擅自改用 Push 補送，避免重複訊息與額外費用。
 */
function lineReply_(token, messages, cfg) {
  requireValue_(cfg.lineToken, 'LINE_CHANNEL_ACCESS_TOKEN');
  var result = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + cfg.lineToken },
    payload: JSON.stringify({ replyToken: token, messages: messages }), muteHttpExceptions: true
  });
  var status = result.getResponseCode();
  if (status >= 200 && status < 300) return 'replied';
  // replyToken 只能使用一次；結果不明時不改用 Push，避免重複或額外計費。
  if (status === 400) { safeLog_('LINE_REPLY_400'); return 'reply_rejected'; }
  throw new Error('LINE_HTTP_' + status);
}
