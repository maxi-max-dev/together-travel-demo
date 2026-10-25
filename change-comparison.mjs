// Render only fields already exposed by GroupCore.project. Never read profiles,
// raw conversations, stored grants, or budget caps to explain a change.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const money=value=>finite(value)?`¥${value.toLocaleString('zh-CN',{maximumFractionDigits:2})}`:'待核价';
const number=value=>finite(value)?String(value):'待核对';
const list=value=>Array.isArray(value)?value:[];
const stamp=value=>{
 if(value===null||value===undefined||value==='')return '时间待核对';
 const time=typeof value==='number'?value:Date.parse(value);
 return Number.isFinite(time)?new Date(time+8*3600000).toISOString().slice(0,16).replace('T',' '):'时间待核对';
};
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:'日期待核对';
const version=plan=>Number.isInteger(plan?.version)?`v${plan.version}`:'已保存方案';
const reference=plan=>plan?.mode==='live'||plan?.completePrice===false||!finite(plan?.total);
const cost=(subject,plan)=>({amount:finite(subject?.total)?subject.total:finite(subject?.estimateTotal)?subject.estimateTotal:null,reference:reference(plan)||!finite(subject?.total)});
const costText=value=>`${value.reference?'参考估算':'模拟估算'} ${money(value.amount)}`;
const deltaText=(before,after)=>{
 if(!finite(before.amount)||!finite(after.amount))return '费用尚不完整，差额待核价';
 const delta=Math.round((after.amount-before.amount)*100)/100;
 const prefix=before.reference||after.reference?'参考估算':'模拟估算';
 return delta===0?`${prefix}不变`:`${prefix}${delta>0?'增加':'减少'} ${money(Math.abs(delta))}`;
};
const row=(title,before,after,status='')=>`<div class="comparison-row"><dt>${esc(title)}${status?`<span class="comparison-change${status==='保留'?' is-kept':''}">${esc(status)}</span>`:''}</dt><dd><span class="comparison-sr">变更前：</span>${before}</dd><dd><span class="comparison-sr">当前方案：</span>${after}</dd></div>`;
const legKey=leg=>leg?JSON.stringify([leg.id,leg.from,leg.to,leg.startAt,leg.endAt]):null;
function leg(leg,plan){
 if(!leg)return '<span class="comparison-muted">无这段交通记录</span>';
 return `<strong>${esc(leg.from||'出发地待核')} → ${esc(leg.to||'目的地待核')}</strong><span>${esc(stamp(leg.startAt))}</span><span>抵达 ${esc(stamp(leg.endAt))}</span>${leg.flight?`<span>${esc(leg.flight)}</span>`:''}<small>${reference(plan)?'参考票价':'模拟票价'} ${money(leg.price)}</small>`;
}
const allocation=(plan,member)=>list(plan?.hotel?.allocations).find(a=>list(a.memberIds).includes(member?.id));
const stayKey=(plan,member)=>{
 if(!member)return null;
 const a=allocation(plan,member);
 return JSON.stringify([plan?.hotel?.id,member.stayStart||plan?.start,member.stayEnd||plan?.end,a?.label,list(a?.memberIds).slice().sort(),a?.start,a?.end]);
};
function stay(plan,member){
 if(!member)return '<span class="comparison-muted">无这位成员的住宿记录</span>';
 const a=allocation(plan,member),share=finite(member.hotelShare)?member.hotelShare:member.hotelEstimate;
 return `<strong>${esc(plan?.hotel?.name||'住宿待核对')}</strong>${a?.label?`<span>${esc(a.label)}</span>`:''}<span>${esc(date(member.stayStart||plan?.start))} 至 ${esc(date(member.stayEnd||plan?.end))}</span><span>${finite(member.stayNights)?`${member.stayNights} 晚`:'晚数待核对'}</span><small>${reference(plan)||!finite(member.hotelShare)?'参考承担':'模拟承担'} ${money(share)}</small>`;
}
function memberCard(room,before,after,id){
 const a=list(before.members).find(m=>m.id===id),b=list(after.members).find(m=>m.id===id);
 const person=list(room.members).find(m=>m.id===id),confirmation=list(after.confirmations).find(c=>c.id===id),change=list(after.changes).find(c=>c.id===id);
 const current=after.conditionVersion===room.conditionVersion;
 const grant=person?.consent;
 const confirmed=!!b&&current&&grant?.planVersion===after.version&&(!finite(grant.deadline)||grant.deadline>Date.now());
 const status=!b?'已不在当前方案':!current?'方案待更新':confirmed?(confirmation?.kept?'已保留同意':'已确认当前版本'):'需要重新确认';
 const changeFor=direction=>!a?'新增':!b?'移除':(change?.[direction==='out'?'outChanged':'backChanged']||legKey(a[direction])!==legKey(b[direction]))?'已变更':'保留';
 const feeBefore=cost(a,before),feeAfter=cost(b,after);
 return `<article class="comparison-person"><header><h3>${esc(b?.name||a?.name||'同行成员')}</h3><span class="comparison-consent${confirmed?' is-confirmed':''}">${esc(status)}</span></header><div class="comparison-columns" aria-hidden="true"><span>变更前 · ${esc(version(before))}</span><span>当前 · ${esc(version(after))}</span></div><dl>${row('去程',leg(a?.out,before),leg(b?.out,after),changeFor('out'))}${row('返程',leg(a?.back,before),leg(b?.back,after),changeFor('back'))}${row('住宿',stay(before,a),stay(after,b),!a?'新增':!b?'移除':stayKey(before,a)===stayKey(after,b)?'保留':'已变更')}${row('整趟费用',a?`<strong>${esc(costText(feeBefore))}</strong>`:'未加入此方案',b?`<strong>${esc(costText(feeAfter))}</strong>`:'已退出此方案')}</dl><p class="comparison-cost-change">${a&&b?esc(deltaText(feeBefore,feeAfter)):'成员变化后，按当前方案重新核对费用。'}</p><p class="comparison-reason">${confirmed?esc(confirmation?.kept?'已保留原授权范围内的同意。':'本人已确认当前版本。'):esc(!b?'不再要求这位成员确认当前方案。':!current?'条件已有更新，请先生成新方案。':confirmation?.kept?'原同意已不适用，请本人核对当前安排与授权范围。':confirmation?.reason||'请本人核对当前安排与授权范围。')} 费用相同也不代表已经同意。</p></article>`;
}
function metric(label,before,after,detail=''){
 return `<div class="comparison-metric"><dt>${esc(label)}</dt><dd><span><small>变更前</small>${esc(before)}</span><span class="comparison-arrow" aria-hidden="true">→</span><span><small>当前</small>${esc(after)}</span>${detail?`<p>${esc(detail)}</p>`:''}</dd></div>`;
}
function retained(room){
 const items=new Map();
 for(const item of [...list(room.retainedOrders),...list(room.batch?.items).filter(i=>i.retained)])if(item.status==='paid'&&item.id)items.set(item.id,item);
 if(!items.size)return '<p class="comparison-empty-paid">这次没有需要保留的已模拟付款项目。</p>';
 return `<div class="comparison-paid"><h3>这些已模拟付款，保留原单</h3><ul>${[...items.values()].map(item=>`<li><div><strong>${esc(item.label||'已付项目')}</strong><span>付款人：${esc(list(room.members).find(m=>m.id===item.ownerId)?.name||'原付款人')}</span><code>原 ID：${esc(item.id)}</code></div><div><strong>${money(item.amount)}</strong><span>原金额固定 · 已模拟付款</span></div></li>`).join('')}</ul><p>保留原 ID 与已付金额；不重复创建或扣款。若后续安排冲突，仍需付款人明确确认模拟退订及损失。</p></div>`;
}

/** HTML for the two saved plan versions, safe for direct innerHTML insertion. */
export function renderChangeComparison(room){
 const before=room?.previousPlan,after=room?.plan;
 if(!before||!after||(before.id===after.id&&before.version===after.version))return '';
 const ids=[...new Set([...list(after.members),...list(before.members)].map(m=>m.id))];
 const shared=after.sharedChanges||{};
 const oldHours=finite(before.hours)?before.hours:shared.oldHours,newHours=finite(after.hours)?after.hours:shared.newHours;
 const nights=p=>finite(p.roomNights)?p.roomNights:finite(p.rooms)&&finite(p.nights)?p.rooms*p.nights:null;
 const oldNights=nights(before)??shared.oldRoomNights,newNights=nights(after)??shared.newRoomNights;
 const oldCost=cost(before,before),newCost=cost(after,after);
 return `<section class="change-comparison" aria-label="改期前后对比"><header class="comparison-heading"><div><p>变更前 ${esc(version(before))} → 当前 ${esc(version(after))}</p><h2>改期后，谁的安排变了</h2></div><span>已保存的两版方案</span></header><dl class="comparison-metrics">${metric('共同会合窗口',`${number(oldHours)} 小时`,`${number(newHours)} 小时`,'包含休息时间；不是净游玩时长。')}${metric('共同住宿',`${number(oldNights)} 房晚`,`${number(newNights)} 房晚`,`${number(before.rooms??shared.oldRooms)} 间 → ${number(after.rooms??shared.newRooms)} 间`)}${metric('全组整趟费用',costText(oldCost),costText(newCost),deltaText(oldCost,newCost))}</dl><div class="comparison-window"><span><strong>原会合窗口</strong>${esc(stamp(before.meetAt))} — ${esc(stamp(before.leaveAt))}</span><span><strong>当前会合窗口</strong>${esc(stamp(after.meetAt))} — ${esc(stamp(after.leaveAt))}</span></div><p class="comparison-caption">以下时间均为北京时间。费用含生活预留与已发生模拟损失；参考估算不能作为含费实付价或预算通过的依据。</p><div class="comparison-people">${ids.map(id=>memberCard(room,before,after,id)).join('')}</div>${retained(room)}</section>`;
}
