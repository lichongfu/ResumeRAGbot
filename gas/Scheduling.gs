/** 此 bot 的共享時段表；不讀寫 Google Calendar。所有保留／預訂在指令碼鎖內完成。 */
function schedulingData_(store) {
  var data = store.scheduling || (store.scheduling = { slots: {}, bookings: {}, inputs: {} }), now = Date.now();
  Object.keys(data.slots).forEach(function (id) { var slot = data.slots[id]; if (slot.hold && slot.hold.until <= now) delete slot.hold;
    if (Date.parse(slot.end) < now - 30 * 86400000) delete data.slots[id]; });
  Object.keys(data.bookings).forEach(function (id) { if (Date.parse(data.bookings[id].end) < now - 30 * 86400000) delete data.bookings[id]; });
  Object.keys(data.inputs).forEach(function (id) { if (data.inputs[id].expiresAt <= now) delete data.inputs[id]; });
  return data;
}
function schedulingChange_(cfg, change, alreadyLocked) {
  if (alreadyLocked) { var store = loadPortfolioStore_(cfg), result = change(schedulingData_(store), store); savePortfolioStore_(store, cfg); return result; }
  return updatePortfolioStore_(cfg, function (store) { return change(schedulingData_(store), store); });
}
function schedulingLabel_(slot) {
  return Utilities.formatDate(new Date(slot.start), 'Asia/Taipei', 'yyyy-MM-dd HH:mm') + '～' + Utilities.formatDate(new Date(slot.end), 'Asia/Taipei', 'HH:mm') + '（台北時間）';
}
function schedulingParse_(text) {
  var match = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*\/\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/.exec(text);
  if (!match) throw new Error('SLOT_INVALID_TIME');
  var times = match.slice(1).map(function (part) { var time = Date.parse(part.replace(' ', 'T') + ':00+08:00');
    if (!Number.isFinite(time) || new Date(time + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') !== part) throw new Error('SLOT_INVALID_TIME'); return time; });
  if (times[0] <= Date.now() || times[0] > Date.now() + 90 * 86400000 || times[1] - times[0] < 15 * 60000 || times[1] - times[0] > 180 * 60000) throw new Error('SLOT_INVALID_TIME');
  return { start: new Date(times[0]).toISOString(), end: new Date(times[1]).toISOString() };
}
function releaseInterviewHold_(user, draft, cfg, alreadyLocked) {
  if (!draft || !draft.slotId) return;
  schedulingChange_(cfg, function (data) { var slot = data.slots[draft.slotId];
    if (slot && slot.hold && slot.hold.actor === invitationVisitor_(user) && slot.hold.draftId === draft.id) delete slot.hold;
  }, alreadyLocked);
}
/** 必須與邀約紀錄共用同一次 savePortfolioStore_，不能先預訂後另存邀約。 */
function commitInterviewBooking_(store, draft, record, user) {
  if (!draft.slotId) return true;
  var data = schedulingData_(store), slot = data.slots[draft.slotId], actor = invitationVisitor_(user);
  if (!slot || !slot.open || slot.bookingId || Date.parse(slot.start) <= Date.now() || !slot.hold || slot.hold.actor !== actor || slot.hold.draftId !== draft.id || slot.hold.until <= Date.now()) return false;
  var booking = { id: record.id, slotId: slot.id, actor: actor, start: slot.start, end: slot.end, status: 'reserved', createdAt: new Date().toISOString() };
  slot.bookingId = record.id; delete slot.hold; data.bookings[record.id] = booking;
  record.booking = { slotId: slot.id, start: slot.start, end: slot.end, status: 'reserved' };
  record.fields.availability = schedulingLabel_(slot); return true;
}
function schedulingList_(user, cfg) {
  var actor = invitationVisitor_(user), draft = invitationDraft_(invitationKey_(user, cfg));
  var slots = schedulingChange_(cfg, function (data) { return Object.keys(data.slots).map(function (id) { return data.slots[id]; }).filter(function (slot) {
    return slot.open && !slot.bookingId && Date.parse(slot.start) > Date.now() && (!slot.hold || slot.hold.actor === actor && draft && slot.hold.draftId === draft.id);
  }).sort(function (a, b) { return Date.parse(a.start) - Date.parse(b.start); }).slice(0, 10); });
  var actions = slots.map(function (slot, i) { return ['選時段 ' + (i + 1), 'slot:pick:' + slot.id + (draft && draft.step < 5 ? ':' + draft.id : '')]; });
  actions.push(['我的預約', 'slot:mine']); if (user === ownerLineUserId_()) actions.push(['管理時段', 'slot:admin']);
  return jobMessage_(slots.length ? '可面談時段\n' + slots.map(function (slot, i) { return (i + 1) + '. ' + schedulingLabel_(slot); }).join('\n') +
    '\n\n選擇後暫留五分鐘；仍需填寫並確認邀約，才會登記預約。此表只管理本 bot，未同步其他行事曆。' : '目前沒有可預約時段。仍可留下邀約，填寫方便聯繫的時間。', actions);
}
function handleScheduling_(event, text, cfg) {
  var user = event.source.userId, actor = invitationVisitor_(user), parts = text.split(':'), explicit = /^slot:/.test(text) || /^(管理面談時段|預約面談|我的預約)$/.test(text);
  try {
    var store = loadPortfolioStore_(cfg), priorInput = store.scheduling && store.scheduling.inputs && store.scheduling.inputs[actor];
    var data = schedulingData_(store), input = data.inputs[actor];
    if (!explicit && priorInput && priorInput.expiresAt <= Date.now()) {
      schedulingChange_(cfg, function () {});
      return jobMessage_('新增時段的輸入已過期，剛才文字未送給 AI，也未發布時段。請重新開啟設定。', [['管理時段', 'slot:admin']]);
    }
    if (!explicit && !input) return null;
    var action = parts[1] || 'list';
    if (text === '管理面談時段') action = 'admin'; if (text === '預約面談') action = 'list'; if (text === '我的預約') action = 'mine';
    if (['pick', 'close', 'closeyes'].indexOf(action) >= 0 && !/^[a-f0-9]{16}$/.test(parts[2] || '')) return jobMessage_('時段按鈕已失效，請重新選擇。', [['查看時段', 'slot:list']]);
    if (['cancel', 'cancelok'].indexOf(action) >= 0 && !/^[a-f0-9]{32}$/.test(parts[2] || '')) return jobMessage_('預約按鈕已失效，請重新開啟。', [['我的預約', 'slot:mine']]);
    var owner = user === ownerLineUserId_();
    if (!explicit && /^(取消|首頁)$|^(jg:|rc:|invite:|nav:)/.test(text)) { schedulingChange_(cfg, function (d) { delete d.inputs[actor]; }); return text === '取消' ? jobMessage_('已取消新增時段。', [['管理時段', 'slot:admin']]) : null; }
    if (!explicit && input) {
      if (!owner || input.kind !== 'slot') return jobMessage_('設定已失效，請重新開啟。');
      var times; try { times = schedulingParse_(text); } catch (_) { return jobMessage_('時間格式或範圍不正確。請輸入：\nYYYY-MM-DD HH:mm / YYYY-MM-DD HH:mm\n台北時間，未來 90 天內，長度 15～180 分鐘。'); }
      var outcome = schedulingChange_(cfg, function (d) {
        var all = Object.keys(d.slots).map(function (id) { return d.slots[id]; });
        if (all.filter(function (slot) { return slot.open && Date.parse(slot.end) > Date.now(); }).length >= 30) return 'capacity';
        if (all.some(function (slot) { return (slot.open || slot.bookingId) && Date.parse(times.start) < Date.parse(slot.end) && Date.parse(times.end) > Date.parse(slot.start); })) return 'overlap';
        var id = sha256_(Utilities.getUuid()).slice(0, 16); d.slots[id] = { id: id, start: times.start, end: times.end, open: true }; delete d.inputs[actor]; return 'saved';
      });
      return jobMessage_(outcome === 'saved' ? '已發布面談時段：' + schedulingLabel_(times) : outcome === 'overlap' ? '與已發布或已預訂時段重疊，尚未新增。請換一個時段。' : '最多三十個未來時段，請先關閉不再使用的時段。', [['管理時段', 'slot:admin']]);
    }
    if (action === 'list') return schedulingList_(user, cfg);
    if (['admin', 'add', 'close', 'closeyes'].indexOf(action) >= 0 && !owner) return jobMessage_('只有已設定的履歷本人帳號可以管理時段。請由本人設定 OWNER_LINE_USER_ID。');
    if (action === 'admin') {
      var all = Object.keys(data.slots).map(function (id) { return data.slots[id]; }).filter(function (slot) { return Date.parse(slot.end) > Date.now(); }).sort(function (a, b) { return Date.parse(a.start) - Date.parse(b.start); });
      return jobMessage_('本人時段管理\n' + (all.length ? all.map(function (slot, i) { return (i + 1) + '. ' + schedulingLabel_(slot) + '｜' + (slot.bookingId ? '已預訂' : slot.hold ? '暫留中' : slot.open ? '開放' : '關閉'); }).join('\n') : '尚未發布時段。') +
        '\n已預訂時段需先取消預約才能關閉。未同步 Google Calendar。', [['新增時段', 'slot:add'], ['全部預約', 'slot:mine']].concat(all.filter(function (slot) { return slot.open && !slot.bookingId; }).slice(0, 8).map(function (slot, i) { return ['關閉可用時段 ' + (i + 1), 'slot:close:' + slot.id]; })));
    }
    if (action === 'add') {
      guideChange_(user, cfg, function (rows, key) { if (rows[key]) { rows[key].paused = true; if (rows[key].recruiting) delete rows[key].recruiting.input; } });
      schedulingChange_(cfg, function (d) { d.inputs[actor] = { kind: 'slot', expiresAt: Date.now() + 1800000 }; });
      return jobMessage_('請輸入起訖時間：\nYYYY-MM-DD HH:mm / YYYY-MM-DD HH:mm\n使用台北時間，未來 90 天內，長度 15～180 分鐘。輸入「取消」離開。');
    }
    if (action === 'close') return jobMessage_('確認關閉這個時段？其他人將無法選擇。', [['確認關閉', 'slot:closeyes:' + parts[2]], ['保留', 'slot:admin']]);
    if (action === 'closeyes') {
      var closed = schedulingChange_(cfg, function (d) { var slot = d.slots[parts[2]]; if (!slot || slot.bookingId) return false; slot.open = false; delete slot.hold; return true; });
      return jobMessage_(closed ? '已關閉時段。' : '時段不存在或已預訂，尚未關閉。', [['管理時段', 'slot:admin']]);
    }
    if (action === 'pick') {
      var draft = invitationDraft_(invitationKey_(user, cfg));
      if (parts[3] && (!draft || draft.id !== parts[3] || draft.step >= 5)) return jobMessage_('這張選時段卡片已失效，請重新選擇。', [['查看時段', 'slot:list']]);
      if (!draft || draft.step >= 5) { handleContact_(event, 'invite:start', cfg, null); draft = invitationDraft_(invitationKey_(user, cfg)); }
      if (!draft) return jobMessage_('邀約草稿未能建立，請稍後再試。');
      var slot = schedulingChange_(cfg, function (d) {
        var target = d.slots[parts[2]];
        if (!target || !target.open || target.bookingId || Date.parse(target.start) <= Date.now() || target.hold && (target.hold.actor !== actor || target.hold.draftId !== draft.id)) return null;
        Object.keys(d.slots).forEach(function (id) { var previous = d.slots[id]; if (previous.hold && previous.hold.actor === actor && previous.hold.draftId === draft.id) delete previous.hold; });
        target.hold = { actor: actor, draftId: draft.id, until: Date.now() + 300000 }; return target;
      });
      if (!slot) return jobMessage_('此時段剛被保留、預訂或關閉，沒有建立你的預約。請選其他時間。', [['重新選時段', 'slot:list']]);
      draft.slotId = slot.id; draft.fields.availability = schedulingLabel_(slot); if (draft.step === 3) draft.step = 4;
      CacheService.getScriptCache().put(invitationKey_(user, cfg), JSON.stringify(draft), 1800);
      return [jobMessage_('已暫留五分鐘：' + schedulingLabel_(slot) + '\n請完成邀約並確認送出，才會登記預約。')[0]].concat(draft.step === 4 ? invitationConfirmation_(draft) : invitationPrompt_(draft));
    }
    if (action === 'mine') {
      var bookings = Object.keys(data.bookings).map(function (id) { return data.bookings[id]; }).filter(function (b) { return owner || b.actor === actor; }).sort(function (a, b) { return Date.parse(a.start) - Date.parse(b.start); });
      return jobMessage_((owner ? '全部預約' : '我的預約') + '\n' + (bookings.length ? bookings.map(function (b, i) { return (i + 1) + '. ' + schedulingLabel_(b) + '｜' + (b.status === 'cancelled' ? '已取消' : '已保留，待確認細節'); }).join('\n') : '尚無預約。'),
        bookings.filter(function (b) { return b.status === 'reserved'; }).slice(0, 10).map(function (b, i) { return ['取消預約 ' + (i + 1), 'slot:cancel:' + b.id]; }).concat([['查看可用時段', 'slot:list']]));
    }
    if (action === 'cancel' || action === 'cancelok') {
      var booking = data.bookings[parts[2]];
      if (!booking || !owner && booking.actor !== actor) return jobMessage_('找不到你可管理的預約。');
      if (action === 'cancel') return jobMessage_('取消 ' + schedulingLabel_(booking) + ' 的預約？確認後釋放時段，請自行與對方確認取消細節。', [['確認取消', 'slot:cancelok:' + booking.id], ['保留預約', 'slot:mine']]);
      schedulingChange_(cfg, function (d, store) { var b = d.bookings[parts[2]]; if (!b || !owner && b.actor !== actor) return; b.status = 'cancelled';
        var slot = d.slots[b.slotId]; if (slot && slot.bookingId === b.id) delete slot.bookingId;
        var invitation = (store.invitations || {})[b.id]; if (invitation && invitation.booking) { invitation.booking.status = 'cancelled'; invitation.fields.availability = schedulingLabel_(b) + '（預約已取消）'; }
      });
      return jobMessage_('已取消預約並釋放時段。系統未自動寄送取消通知，請自行告知對方。', [['我的預約', 'slot:mine']]);
    }
    return schedulingList_(user, cfg);
  } catch (error) { safeLog_('SCHEDULING_' + errorCode_(error)); return jobMessage_('時段操作未能確認完成，請重新查看狀態。', [['我的預約', 'slot:mine'], ['查看時段', 'slot:list']]); }
}
