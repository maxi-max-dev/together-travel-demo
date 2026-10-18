import {cleanDraft,ruleTurn,draftSummary} from './intake-model.mjs';
const states=new Map();
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const blank=initial=>({draft:cleanDraft(initial),turns:[],pending:'',input:'',waiting:false,error:'',revision:0});
export function intakeState(key,initial){if(!states.has(key)){let saved;try{saved=JSON.parse(sessionStorage.getItem(key==='landing'?'together-landing-draft-v9':'together-input-v9:'+key))}catch{}states.set(key,{...blank(initial),...saved});}return states.get(key);}
export function seedIntake(key,draft,turns=[]){states.set(key,{...blank(draft),turns});}
export function mountIntake(root,{key,personal=false,initial={},saved,live=false,request,sendTurn,onSaved=()=>{},onApply,onDirty=()=>{},subjectName='',destination='',reviewedAt=0} ){
 if(!root)return;const state=intakeState(key,initial);
 if(saved&&!state.waiting&&(saved.revision>state.revision||saved.profileRevision!==state.profileRevision)){const input=state.input;Object.assign(state,{...saved,draft:cleanDraft(saved.draft),error:'',input});}
 const keepInput=()=>{if(key!=='landing')try{sessionStorage.setItem('together-input-v9:'+key,JSON.stringify({input:state.input}));}catch{}};
 const draw=()=>{
  const summary=draftSummary(state.draft),check=state.draft.requirements;
  root.innerHTML=`<div class="conversation-heading"><span class="conversation-mark" aria-hidden="true">↗</span><div><strong>${personal?(subjectName?'先帮 '+esc(subjectName)+' 整理':'只说你的，我们来凑成一趟'):'先说说，你想怎么一起玩'}</strong><small>${live?'百炼 · 真实 AI 对话':'流程演练 · 规则整理'}${personal&&!subjectName?' · 对话仅自己可见':''}</small></div></div>
  <div class="chat-checklist" aria-label="可以告诉助手的事情">${[['origin','出发地'],['start','去 / 回时间'],['budget','个人预算'],['prefs','喜欢 / 避开']].map(([k,t])=>`<span class="${(Object.hasOwn(check,k)||(k==='prefs'&&['likes','musts','avoids'].some(k=>check[k]?.length)))?'done':''}">${(Object.hasOwn(check,k)||(k==='prefs'&&['likes','musts','avoids'].some(k=>check[k]?.length)))?'✓':'＋'} ${t}</span>`).join('')}<span class="${Object.hasOwn(check,'directOnly')?'done':''}">${Object.hasOwn(check,'directOnly')?'✓':'＋'} 航班限制</span></div>
  <div class="conversation-log" role="log" aria-live="polite" aria-label="需求对话"><div class="chat-message assistant">${personal?(subjectName?'按这位朋友的视角整理草稿，邀请加入后仍需本人确认。':`你们${destination?'约好去'+esc(destination):'准备一起出发'}。只需要告诉我自己的安排，可以比朋友早到、早回。确认后的条件会出现在共同旅行桌。`):'可以是一个初步想法，也可以是一段攻略。先说你自己的时间、预算和期待，朋友有空时再来补充。'}</div>${state.turns.map(t=>`<div class="chat-message ${t.role}"><span class="sr-only">${t.role==='user'?'你':'助手'}：</span>${esc(t.text).replace(/\n/g,'<br>')}</div>`).join('')}${state.waiting?'<div class="chat-message assistant" role="status">正在整理你刚才说的…</div>':''}</div>
  ${state.error?`<p class="chat-error" role="alert">${esc(state.error)}</p>`:''}
  ${!state.turns.length?`<div class="conversation-examples"><button type="button" data-intake-example="${personal?'我从北京出发，10月23日到25日，个人预算2500，只坐直飞，不坐红眼，想去上博。':'我和朋友约好去上海，我从成都出发，10月23日到25日，个人预算2500，想去看展，不想太赶。'}">${personal?'从我的时间和预算开始':'异地出发，在上海过周末'} ↗</button><button type="button" data-intake-example="先估价，不设预算，想玩得轻松一点。">还没定预算 ↗</button></div>`:''}
  <form class="conversation-composer"><label class="sr-only" for="conversation-input">${personal?'补充或修改你的想法':'说说这趟旅行'}</label><textarea id="conversation-input" name="message" rows="3" maxlength="1800" placeholder="${personal?'比如：我想提前一天回来，最晚21:00落地，其他条件不变。':'比如：我和朋友周末去上海。我从成都出发，预算2500，想看展、吃点好的……'}" ${state.waiting?'disabled':''}>${esc(state.input)}</textarea><div class="composer-bottom"><span>${personal?'本次旅行会接着记住':'朋友稍后可以自己加入'} · 先整理，后确认</span><button type="submit" class="primary" ${state.waiting?'disabled':''}>${state.waiting?'整理中…':'发送 ↑'}</button></div></form>
  ${summary.length?`<div class="conversation-draft"><span class="section-label">${personal&&reviewedAt&&(!state.updatedAt||reviewedAt>=state.updatedAt)?'已确认的个人条件':'我的草稿 · 还没告诉同行者'}</span><ul>${summary.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}
  <div class="conversation-next"><button type="button" class="${state.turns.length?'secondary':'text'}" data-intake-apply ${state.waiting?'disabled':''}>${personal?'核对并分享我的条件':'核对条件，创建旅行'} →</button><span>${state.updatedAt?'对话已保存':'随时可以修改'}</span></div>`;
  const log=root.querySelector('.conversation-log');log.scrollTop=log.scrollHeight;
 };
 const send=async()=>{
  if(state.waiting)return;const input=root.querySelector('textarea').value.trim();if(!input)return;
  const turns=[...state.turns,{role:'user',text:input}];
  state.waiting=true;state.error='';state.input=input;draw();onDirty(true);
  try{
   if(sendTurn){const result=await sendTurn(input,state);Object.assign(state,result.conversation,{input:''});onSaved(result.room);}
   else{
    const result=live?await request('/api/v4/intake',{method:'POST',data:{turns:turns.slice(-19),draft:state.draft,personal},credential:null}):ruleTurn(state,input,{personal});
    state.draft=result.draft;state.pending=result.pending;state.turns=[...turns,{role:'assistant',text:result.answer}];state.input='';state.receipt=result.receipt;
    if(key==='landing')try{sessionStorage.setItem('together-landing-draft-v9',JSON.stringify({draft:state.draft,turns:state.turns.slice(-20),pending:state.pending}));}catch{}
   }
   onDirty(false);
  }catch(e){state.error=e.message+' 原文已保留。';}
  finally{state.waiting=false;keepInput();if(root.isConnected){draw();root.querySelector('textarea').focus();}}
 };
 root.onsubmit=e=>{e.preventDefault();e.stopPropagation();send();};
 root.oninput=e=>{if(e.target.name==='message'){state.input=e.target.value;keepInput();onDirty(true);}};
 root.onclick=e=>{const example=e.target.closest('[data-intake-example]');if(example){state.input=example.dataset.intakeExample;keepInput();draw();root.querySelector('textarea').focus();onDirty(true);}if(e.target.closest('[data-intake-apply]')&&!state.waiting)onApply(state.draft,state.input.trim()?[...state.turns,{role:'user',text:state.input}]:state.turns);};
 draw();
}
