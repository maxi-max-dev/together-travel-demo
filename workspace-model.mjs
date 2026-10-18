// Read-only presentation decisions. The server remains the authority for actions.
export function nextTask(room) {
  const self = room.members.find(m => m.id === room.viewerId);
  const pending = room.members.filter(m => !m.joined || !m.confirmed);
  if(self?.proposal)return {view:'mine',title:'组织者提出了修改建议',body:'原条件继续生效，先核对建议内容，再由你决定是否采纳。',label:'核对修改建议',tone:'warm'};
  if (room.batch) {
    if (room.stage === 'completed') return {view:'book', title:'这趟已经安排好了', body:'各人的交通、共同住宿和活动待办已收进出行清单。', label:'查看出行清单', tone:'good'};
    if (room.batch.needsReview) return {view:'plan', title:'保留已付项目，调整剩余安排', body:'先比较新方案，系统会标明需要谁确认。只有与新条件冲突的已付项目才需要处理。', label:'查看局部调整', tone:'warm'};
    const incomplete = room.batch.items.filter(i => ['failed','expired','cancelled'].includes(i.status));
    if (incomplete.length) {
      const own = incomplete.filter(i => i.ownerId === room.viewerId);
      return {view:'book', title:own.length?`你有 ${own.length} 项预订需要补齐`:'等朋友补齐预订，再继续付款', body:'整趟清单中有失败、过期或取消的项目，其他付款已暂停；已有记录继续保留。', label:own.length?'处理未完成项目':'查看缺少的项目', tone:'warm'};
    }
    const mine = room.batch.items.filter(i => i.ownerId === room.viewerId && i.status !== 'paid');
    return {view:'book', title:mine.length ? `你有 ${mine.length} 项预订待处理` : '你的项目已处理，等朋友完成', body:'按清单标注的付款人逐项处理。费用承担与垫付分别展示，当前全部为模拟订单。', label:mine.length?'查看我的待办':'查看全组进度', tone:mine.length?'warm':'normal'};
  }
  if (!self?.confirmed) return {view:'mine', title:'先确认你自己的旅行条件', body:'说说从哪出发、什么时候有空，以及哪些安排不能接受。', label:'填写我的想法', tone:'normal'};
  if (room.ideas.some(i => !i.votes[room.viewerId])) return {view:'team', title:'有共同愿望等你表态', body:'收藏只是提议。说清你想去、不想去，大家才能一起决定。', label:'表达我的意见', tone:'warm'};
  if (!self.profile.destinations.includes(room.destination)) return {view:'mine', title:'先确认这个目的地适不适合你', body:`当前大家在讨论${room.destination}。你可以接受，也可以提出别的选择。`, label:'查看我的条件', tone:'warm'};
  if (pending.length) return {view:room.isOwner&&pending.some(m=>!m.joined)?'mine':'team', title:`等${pending.map(m=>m.name).join('、')}确认条件`, body:room.isOwner&&pending.some(m=>!m.joined)?'把各自的邀请发给朋友，领取后由他们自己填写。':'你的条件已保存，等待时可以先整理共同愿望。', label:room.isOwner&&pending.some(m=>!m.joined)?'查看邀请':'一起整理愿望', tone:'normal'};
  if (room.readyErrors?.length) return {view:'team', title:'还有一个分歧需要一起决定', body:room.readyErrors[0], label:'查看共同安排', tone:'warm'};
  if (!room.plan || room.plan.conditionVersion !== room.conditionVersion) return {view:'plan', title:room.plan?'安排有变化，重新看看怎么去':'条件收齐，可以比较共同方案了', body:(room.plan&&room.changeReason)||'一起比较每个人的花费、抵达时间和能相聚多久。', label:room.plan?'查看重新安排':'比较共同方案', tone:room.plan?'warm':'normal'};
  if (!self.consent) return {view:'watch', title:'这份共同方案，等你确认委托', body:'核对个人上限、目标价和允许变化的范围，再决定交给系统做什么。', label:'确认我的委托', tone:'normal'};
  const unconfirmed=room.members.filter(m=>!m.consent);
  if(unconfirmed.length) return {view:'watch', title:`等${unconfirmed.map(m=>m.name).join('、')}确认委托`, body:'你的授权已经保存。所有人都确认以后，才会开始共同跟进。', label:'查看委托进度', tone:'normal'};
  const labels={paused:['这趟委托已暂停','恢复前不会继续检查，由暂停的成员决定是否恢复。'],expired:['已经到约定的决策时间','当前任务停止，请核对条件并决定新的等待期限。'],stopped:['委托已撤回','任务停止，已有记录保留。'], 'needs-decision':['有变化需要重新决定','先核对变化，再决定是否接受新的安排。'], 'waiting-data':['还缺完整报价，继续核实','未知价格不会按零计算，暂不准备预订清单。'], 'waiting-activity':['先落实必去项目','机酒便宜也不能跳过你们一定要去的活动。'],ready:['整趟条件满足，等你们决定','有人仅授权提醒，系统不会替你们准备订单。']};
  const status=room.watch?.status, state=labels[status];
  return {view:status==='waiting-activity'&&room.isOwner?'team':'watch', title:state?.[0]||'已交给系统，继续等合适的安排', body:state?.[1]||'后台会一起检查每个人的交通、共同住宿和必要活动。出现需要决定的变化，会留在这里。', label:status==='waiting-activity'&&room.isOwner?'查看必去项目':'查看跟进详情', tone:state?'warm':'good'};
}

export function journeyProgress(room) {
  const conditions=room.members.length>=1&&room.members.every(m=>m.joined&&m.confirmed)&&!room.readyErrors?.length;
  const valid=!!room.plan&&room.plan.conditionVersion===room.conditionVersion;
  const consent=valid&&room.members.every(m=>m.consent?.planVersion===room.plan.version);
  const batch=!!room.batch&&!room.batch.needsReview;
  return [
    {label:'收齐想法',done:conditions},
    {label:'共同方案',done:valid},
    {label:'各自授权',done:consent},
    {label:'持续跟进',done:batch},
    {label:'预订交接',done:room.stage==='completed'}
  ];
}
