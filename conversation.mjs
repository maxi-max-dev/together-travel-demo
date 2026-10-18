import {cleanDraft,ruleTurn} from './intake-model.mjs';

// Only this member's confirmed profile and private draft enter the conversation.
export function conversationContext(room,member){
 const saved=member.conversation;
 const draft=saved?.profileRevision===(member.profileRevision||0)?saved.draft:
  {setup:{destination:room.destination},requirements:member.confirmed?member.profile:{destinations:[room.destination]}};
 return {draft:cleanDraft(draft),turns:saved?.turns||[],revision:saved?.revision||0,profileRevision:member.profileRevision||0};
}
export function validateTurn(member,input){
 const error=(message,status=400)=>{throw Object.assign(Error(message),{status});};
 if(typeof input?.text!=='string'||!input.text.trim()||input.text.length>1800)error('每次请说 1–1800 个字。');
 if(input.profileRevision!==(member.profileRevision||0))error('个人条件已改变，请刷新后继续对话。',409);
 if(input.chatRevision!==(member.conversation?.revision||0))error('你在另一个页面有新对话，请刷新后继续。',409);
}
export function makeConversation(room,member,input,result,now){
 validateTurn(member,input);
 const state=conversationContext(room,member);
 const next=result||ruleTurn(state,input.text,{personal:true,now});
 return {revision:state.revision+1,profileRevision:state.profileRevision,draft:cleanDraft(next.draft),pending:next.pending,
  turns:[...state.turns,{role:'user',text:input.text.trim()},{role:'assistant',text:String(next.answer||'请核对条件草稿。').slice(0,1800)}].slice(-80),
  source:next.source,receipt:next.receipt,updatedAt:now};
}
export function seedConversation(input,destination){
 if(!input)return undefined;
 const turns=Array.isArray(input.turns)?input.turns.filter(t=>['user','assistant'].includes(t?.role)&&typeof t.text==='string').slice(-20).map(t=>({role:t.role,text:t.text.slice(0,1800)})):[];
 return {revision:1,profileRevision:0,draft:cleanDraft({...input.draft,setup:{...input.draft?.setup,destination}}),turns,source:'imported-draft'};
}
