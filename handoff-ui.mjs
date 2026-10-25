// Only renders the service's projected handoff. It never certifies or reprices a plan.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>Number.isFinite(value)?`¥${value.toLocaleString('zh-CN',{maximumFractionDigits:2})}`:'尚未记录';
const time=value=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚未记录';
const labels={missing:'待核对',partial:'已保存 · 待补齐',recorded:'人工条目录齐',stale:'旧记录 · 需重新核对'};
const official=url=>{try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&/^(?:[a-z0-9-]+\.)*(?:fliggy|feizhu)\.com$/i.test(u.hostname)?u.href:'';}catch{return '';}};
const hidden=(name,value)=>`<input type="hidden" name="${name}" value="${esc(value)}">`;
export function renderHandoff(room){
 const h=room.handoff;
 const intro='<header class="section-head"><p class="eyebrow">价格还没齐，也知道下一步做什么</p><h1>核对清楚，再接着安排。</h1><p class="lead">各人核对自己的往返，发起人核对共同住宿。记录可以分次补全。</p></header>';
 if(!h||['no-plan','stale-plan'].includes(h.status))return intro+'<section class="panel"><h2>先选定当前条件下的方案</h2><p>旧记录仍会保留，新方案需要重新核对。</p><button class="primary" data-action="view:plan">去看共同方案 →</button></section>';
 return intro+`<section class="handoff-summary panel" aria-label="核价进度"><div><p class="section-label">方案 v${h.planVersion} · 人工交接</p><h2>${h.completed} / ${h.items.length} 项已录齐</h2><p>${esc(h.nextStep)}</p></div><button class="secondary" data-action="handoff-export">导出交接单与待办 ↓</button><p class="handoff-boundary">${room.dataMode==='live'?'候选来自已有搜索。':'当前是虚构场景，填写只用于演练。'} ${esc(h.notice||'人工记录不代表供应商确认、锁价或有票。不会自动放行预算、创建订单或扣款。')}</p></section>
 <ol class="handoff-steps"><li><b>1</b>到官方核对完整价格与规则</li><li><b>2</b>本人记录来源、金额与核对项</li><li><b>3</b>导出并让同行核对，购买前再次验价</li></ol>
 <div class="handoff-items">${h.items.map((item,index)=>{
  const r=item.record||{},url=official(item.sourceUrl)||'https://www.fliggy.com/';
  const details=Array.isArray(item.details)?item.details.join(' · '):item.details||'';
  const assigned=room.members.find(m=>m.id===item.assignedTo)?.name||'对应成员';
  return `<article class="panel handoff-item"><header><div><span class="section-label">${String(index+1).padStart(2,'0')} / ${esc(assigned)}负责</span><h2>${esc(item.label)}</h2><p>${esc(details)}</p></div><span class="pill ${item.status==='recorded'?'good':'warm'}">${labels[item.status]||'待核对'}</span></header>
  <p class="handoff-missing">${item.missing?.length?'还需核对：'+item.missing.map(esc).join('、'):'核对记录已保存；购买前仍需在官方复查，库存随时变化。'}</p>
  <p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${official(item.sourceUrl)?'到飞猪查看候选 ↗':'打开飞猪，按上述条件手动搜索 ↗'}</a></p>
  ${r.at?`<p class="caption">${esc(r.byName||assigned)}记录于 ${time(r.at)}（北京时间） · 人工总额 ${money(r.total)}</p>`:''}
  ${item.canEdit?`<details ${item.status==='recorded'?'':'open'}><summary>${item.status==='recorded'?'查看 / 更新我的记录':'填写我的核对结果'}</summary><form class="handoff-form">
   ${hidden('planVersion',h.planVersion)}${hidden('conditionVersion',h.conditionVersion)}${hidden('itemKey',item.key)}${hidden('identity',item.identity)}
   <div class="form-grid"><label class="field"><span>本项含费总额 · 元（可稍后补）</span><input name="total" type="number" min="0.01" max="10000000" step="0.01" value="${esc(r.total??'')}" placeholder="整项金额，不是每晚起价"></label><label class="field"><span>实际核对的飞猪页面链接（可稍后补）</span><input name="sourceUrl" type="url" maxlength="2048" value="${esc(r.sourceUrl||'')}" placeholder="https://…fliggy.com/…"></label></div>
   <fieldset><legend>只勾选你确实核对过的内容</legend>${item.checks.map(check=>`<label class="check"><input type="checkbox" name="${esc(check.key)}" ${r.checks?.[check.key]?'checked':''}><span>${esc(check.label)}</span></label>`).join('')}</fieldset>
   <label class="field"><span>核对备注（选填；会共享给同行）</span><textarea name="note" maxlength="500" rows="2" placeholder="记录房型、退改限制或还需确认的细节，不填证件与支付信息">${esc(r.note||'')}</textarea></label><button type="submit" class="primary">保存这项核对记录</button><p class="caption">保存不会替你购买，也不会把参考价改成已核实的供应商报价。</p>
  </form></details>`:`<p class="handoff-owner">由${esc(assigned)}本人填写。${r.note?`共同备注：${esc(r.note)}`:''}</p>`}</article>`;
 }).join('')}</div>
 <section class="panel handoff-next"><h2>${h.status==='recorded'?'条目录齐后，接着怎么做？':'记录没齐时，也可以继续'}</h2><p>${h.status==='recorded'?'先导出交接单让同行逐项核对，再在飞猪确认最终价格、库存和退改规则，由本人决定是否购买。这里没有锁价、占位或真实订单。':'未完成项和负责成员都在上方。可以先保存已核对的内容，稍后从本人的入口接着补。改期或换商品后，旧记录会退出本版核对结果。'}</p><div class="inline-actions"><button class="primary" data-action="handoff-export">导出人工交接单</button><button class="secondary" data-action="view:plan">回看共同方案</button><button class="text" data-action="view:watch">查看委托与复查</button></div></section>
 ${h.history?.length?`<details class="panel handoff-history"><summary>过往核对记录（${h.history.length}条）</summary><p>旧版本或已被更新的记录仅用于追溯，不会自动算作当前有效。</p>${h.history.map(r=>`<p><strong>${esc(r.itemLabel||r.label||r.itemKey)}</strong> · 方案 v${esc(r.planVersion)} · ${time(r.at)}<br>${money(r.total)} · ${esc(r.byName||'成员')}人工记录</p>`).join('')}</details>`:''}`;
}
export function downloadHandoff(room){
 const data=room.handoff?.export;if(!data)return;
 const text=typeof data==='string'?data:[`${data.title} · 人工核价交接单`,`方案 v${data.planVersion} / 条件 v${data.conditionVersion}`,room.dataMode==='live'?'已有搜索候选；以下金额由成员人工填写。':'虚构场景与人工填写演练；没有真实报价或预订。',data.notice,`导出时间：${time(Date.now())}（北京时间）`,`下一步：${data.nextStep}`,`人工记录机酒合计：${money(data.total)}（不含生活预留，不是预算通过）`,'',...data.items.flatMap(i=>[i.label,`负责：${i.assignedToName}`,i.details.join('；'),`状态：${labels[i.status]||i.status}`,`待办：${i.missing.length?i.missing.join('；'):'条目录齐，购买前仍需复查'}`,...(i.record?[`人工含费金额：${money(i.record.total)}`,`来源：${i.record.sourceUrl||'待补'}`,`记录人：${i.record.byName} / ${time(i.record.at)}（北京时间）`,`核对项：${Object.entries(i.record.checks).map(([k,v])=>`${({productMatched:'商品日期人数',totalIncludesFees:'完整含费总额',availabilityChecked:'可选库存',termsChecked:'退改规则',baggageChecked:'行李额度'})[k]||k}=${v?'已查看':'待查看'}`).join('；')}`,`共同备注：${i.record.note||'无'}`]:[]),''])].join('\n');
 const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');
 a.href=url;a.download='一起去玩-人工核价交接单.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
