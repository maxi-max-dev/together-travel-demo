import {cleanDraft,ruleTurn,draftSummary,nextQuestion} from './intake-model.mjs';
const states=new Map();
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function intakeState(key,initial){if(!states.has(key))states.set(key,{draft:cleanDraft(initial),turns:[],pending:'',input:'',waiting:false,error:''});return states.get(key);}
export function seedIntake(key,draft){states.set(key,{draft:cleanDraft(draft),turns:[],pending:'',input:'',waiting:false,error:''});}
export function mountIntake(root,{key,personal=false,initial={},live=false,request,onApply,onDirty=()=>{},subjectName=''} ){
 if(!root)return;const state=intakeState(key,initial);
 const draw=()=>{
  const summary=draftSummary(state.draft);
  root.innerHTML=`<div class="conversation-heading"><span class="conversation-mark" aria-hidden="true">↗</span><div><strong>${personal?'先说说你的想法':'先聊聊，这趟想怎么过？'}</strong><small>${live?'百炼 · 真实需求整理':'对话演练 · 规则整理，不调用大模型'}</small></div></div>
  <div class="conversation-log" role="log" aria-live="polite" aria-label="需求对话"><div class="chat-message assistant">${personal?(subjectName?'正在替'+esc(subjectName)+'整理，请按这位同行者的视角描述。这只是草稿，仍需本人确认。':'可以补充或修改条件，也可以问我预算怎么算。整理结果先放入草稿，由本人核对确认。'):'说几句就好：谁想去、从哪儿出发、什么时候有空。还没想好的，我们一项项聊。'}</div>${state.turns.map(t=>`<div class="chat-message ${t.role}"><span class="sr-only">${t.role==='user'?'你':'助手'}：</span>${esc(t.text).replace(/\n/g,'<br>')}</div>`).join('')}${state.waiting?'<div class="chat-message assistant" role="status">正在整理你刚才说的…</div>':''}</div>
  ${state.error?`<p class="chat-error" role="alert">${esc(state.error)}</p>`:''}
  ${!state.turns.length?`<div class="conversation-examples"><span>可以这样开始</span><button type="button" data-intake-example="${personal?'我从上海出发，个人预算3500，只坐直飞，不坐红眼。':'我们两个人想去成都，我从上海出发，下个周末，个人预算3500。'}">${personal?'说说我的预算和限制':'两个人，从不同城市去成都'} ↗</button><button type="button" data-intake-example="预算包括什么？朋友的预算不一样也可以吗？">先问问预算怎么算 ↗</button></div>`:''}
  <form class="conversation-composer"><label class="sr-only" for="conversation-input">${personal?'补充或修改你的想法':'说说这趟旅行'}</label><textarea id="conversation-input" name="message" rows="3" maxlength="1800" placeholder="${personal?'比如：我改成周六出发，返程要在21:00前落地。':'比如：我和朋友想去成都，我从上海、她从深圳出发。下个周末有空，想吃点好的，不要太赶。'}" ${state.waiting?'disabled':''}>${esc(state.input)}</textarea><div class="composer-bottom"><span>Enter 换行 · ${live?'只整理，不替你确认':'可追问，也可直接核对表单'}</span><button type="submit" class="primary" ${state.waiting?'disabled':''}>${state.waiting?'整理中…':'发送 ↑'}</button></div></form>
  ${summary.length?`<div class="conversation-draft"><span class="section-label">目前整理到 · 尚未确认</span><ul>${summary.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}
  <div class="conversation-next"><button type="button" class="${state.turns.length?'secondary':'text'}" data-intake-apply ${state.waiting?'disabled':''}>${personal?'填入条件，继续核对':'看看整理的条件'} →</button><span>${personal?'不修改授权，不自动提交':'还不确定的，也可以在下一步改'}</span></div>`;
  const log=root.querySelector('.conversation-log');log.scrollTop=log.scrollHeight;
 };
 const send=async()=>{
  if(state.waiting)return;const input=root.querySelector('textarea').value.trim();if(!input)return;
  const turns=[...state.turns,{role:'user',text:input}];
  state.waiting=true;state.error='';state.input=input;draw();onDirty();
  try{
   const result=live?await request('/api/v4/intake',{method:'POST',data:{turns:turns.slice(-20),draft:state.draft,personal},credential:null}):ruleTurn(state,input,{personal});
   state.draft=result.draft;state.pending=result.pending;state.turns=[...turns,{role:'assistant',text:result.answer}];state.input='';
   state.receipt=result.receipt;
  }catch(e){state.error=e.message+' 原文已保留，可以重试或直接核对条件。';}
  finally{state.waiting=false;if(root.isConnected){draw();root.querySelector('textarea').focus();}}
 };
 root.onsubmit=e=>{e.preventDefault();e.stopPropagation();send();};
 root.oninput=e=>{if(e.target.name==='message'){state.input=e.target.value;onDirty();}};
 root.onclick=e=>{const example=e.target.closest('[data-intake-example]');if(example){state.input=example.dataset.intakeExample;draw();root.querySelector('textarea').focus();onDirty();}if(e.target.closest('[data-intake-apply]')&&!state.waiting)onApply(state.draft,state.turns);};
 draw();
}
