import {clone,fail,defaults,weekend,invalidate,log,perform,tick,inputsReady,CHECK_MS} from './group-engine.mjs';
import {makeConversation,seedConversation} from './conversation.mjs';
const randomUUID=()=>globalThis.crypto.randomUUID();
const limit=(value,n)=>String(value||'').trim().slice(0,n);
export class GroupCore {
 constructor({clock=()=>Date.now(),token,digest,load=()=>({}),save=()=>{}}={}) {
  this.clock=clock;this.token=token;this.digest=digest;this.save=save;this.rooms=load();this.timer=null;
 }
 persist(){this.save(this.rooms);}
 start(){if(this.timer)return;this.timer=setInterval(()=>this.check(),1000);this.timer.unref?.();}
 stop(){clearInterval(this.timer);this.timer=null;}
 check(){let changed=false;for(const r of Object.values(this.rooms)){const draft=clone(r);if(tick(draft,this.clock())){draft.revision++;draft.updatedAt=this.clock();this.rooms[r.id]=draft;changed=true;}}if(changed)this.persist();return changed;}
 commit(room){room.revision++;room.updatedAt=this.clock();this.rooms[room.id]=room;this.persist();return room;}
 create(input={}) {
  const now=this.clock(),access=this.token(),ownerId=randomUUID(),dates=weekend(now);
  const name=limit(input.name,20);if(!name)fail('请填写你的称呼');
  const destination=['上海','成都','杭州','厦门'].includes(input.destination)?input.destination:'成都';
  const room={id:randomUUID(),title:limit(input.title,50)||`${destination}周末见`,destination,ownerId,revision:0,createdAt:now,updatedAt:now,
   conditionVersion:1,planVersion:0,stage:'collecting',roomMode:'twin',reserve:700,minHours:12,maxWait:120,
   arrangement:input.arrangement==='organizer'?'organizer':'shared',arrivalMode:input.arrivalMode==='independent'?'independent':'together',splitMode:'nights',roomGroups:{},retainedOrders:[],losses:[],
   members:[{id:ownerId,name,joined:true,accessHash:this.digest(access),profile:defaults(0,dates),confirmed:false,consent:null,memory:null}],
   ideas:[],candidates:[],planErrors:[],plan:null,previousPlan:null,changeReason:'',watch:null,batch:null,batches:[],events:[]};
  room.members[0].conversation=seedConversation(input.conversation,destination);
  const count=input.count===undefined?2:Number(input.count);if(!Number.isInteger(count)||count<1||count>6)fail('请选择1–6位出行者');
  for(let i=1;i<count;i++)this.addInvite(room,i===1?(limit(input.friend,20)||'朋友'):`同行 ${i+1}`,now);
  log(room,`${name}发起了${count===1?'单人':'多人'}旅行，可以先整理草稿再邀请。`,now);
  this.commit(room);return {roomId:room.id,memberId:ownerId,access,room:this.project(room,ownerId)};
 }
 authenticate(roomId,access){const r=this.rooms[roomId];if(!r)fail('这趟旅行不存在',404);const m=r.members.find(m=>m.joined&&m.accessHash===this.digest(access));if(!m)fail('请使用自己的参与链接打开，或重新领取邀请',401);return {room:r,member:m};}
 read(roomId,access){const {room,member}=this.authenticate(roomId,access);return this.project(room,member.id);}
 addInvite(room,name,now){if(room.members.length>=6)fail('本轮最多支持 6 位成员');const inviteToken=this.token();room.members.push({id:randomUUID(),name:name||`朋友 ${room.members.length+1}`,joined:false,inviteToken,inviteUntil:now+7*86400000,profile:defaults(room.members.length,weekend(now)),confirmed:false,consent:null,memory:null});}
 inviteInfo(invitation){for(const r of Object.values(this.rooms)){const m=r.members.find(m=>!m.joined&&m.inviteToken===invitation);if(m){if(m.inviteUntil<=this.clock())fail('邀请已过期，请让发起人重新邀请',410);return {roomId:r.id,title:r.title,destination:r.destination,invitedName:m.name,host:r.members.find(x=>x.id===r.ownerId)?.name,count:r.members.length};}}fail('邀请已经领取、撤销或不存在',410);}
 claim(invitation,name){const info=this.inviteInfo(invitation),room=clone(this.rooms[info.roomId]),m=room.members.find(m=>m.inviteToken===invitation&&!m.joined);const access=this.token();m.joined=true;m.name=limit(name,20)||m.name;m.accessHash=this.digest(access);delete m.inviteToken;delete m.inviteUntil;log(room,`${m.name}已通过独立邀请加入。`,this.clock());this.commit(room);return {roomId:room.id,memberId:m.id,access,room:this.project(room,m.id)};}
 action(roomId,access,input={}) {
  const auth=this.authenticate(roomId,access);if(input.revision!==auth.room.revision)fail('旅行刚有更新，已为你保留输入。请查看最新进度后再提交。',409);
  const room=clone(auth.room),id=auth.member.id,now=this.clock(),data=input.data||{};
  if(input.action==='invite'){
   if(id!==room.ownerId)fail('只有发起人可以邀请新成员',403);
   if(room.batch?.items.some(i=>!['cancelled','expired'].includes(i.status))||room.retainedOrders?.length)fail('先完成当前预订交接，再增加成员');
   invalidate(room,'新成员加入前，需要重新确认共同安排。',now);this.addInvite(room,limit(data.name,20),now);
  }else if(input.action==='remove-member'){
   if(id!==room.ownerId)fail('只有发起人可以移除成员',403);if(data.memberId===id)fail('发起人不能移除自己');
   if(room.batch?.items.some(i=>!['cancelled','expired'].includes(i.status))||room.retainedOrders?.length)fail('先处理已有预订单，不能直接移除成员');
   const target=room.members.find(m=>m.id===data.memberId);if(!target)fail('成员不存在',404);
   invalidate(room,`${target.name}已退出这趟旅行，重新核对人数和费用。`,now);room.members=room.members.filter(m=>m.id!==data.memberId);for(const idea of room.ideas)delete idea.votes[data.memberId];
  }else perform(room,id,input.action,data,now);
  this.commit(room);return this.project(room,id);
 }
 conversation(roomId,access,input,result){
  const {room,member}=this.authenticate(roomId,access),draft=clone(room),m=draft.members.find(x=>x.id===member.id);
  m.conversation=makeConversation(draft,m,input,result,this.clock());this.commit(draft);
  return {conversation:clone(m.conversation),room:this.project(draft,m.id)};
 }
 project(room,id) {
  const r=clone(room);r.viewerId=id;r.isOwner=id===r.ownerId;r.readyErrors=inputsReady(room);r.checkIntervalMs=CHECK_MS;
  delete r.priorConsents;
  for(const m of r.members){delete m.accessHash;
   if(m.id!==id&&!r.isOwner)delete m.proposal;
   if(m.id!==id&&!r.isOwner)delete m.delegation;
   if(!r.isOwner||m.joined)delete m.inviteToken;
   if(m.id!==id){delete m.conversation;delete m.profile.brief;delete m.memory;delete m.profile.remember;
    if(!m.profile.shareBudget&&!(r.isOwner&&!m.confirmed))m.profile.budget=null;
    if(r.isOwner&&m.delegation)m.delegation={enabled:true,until:m.delegation.until,cap:m.delegation.cap,flexGroup:m.delegation.flexGroup};
    if(m.consent){delete m.consent.cap;delete m.consent.target;}
   }
  }
  for(const p of [r.plan,r.previousPlan,...r.candidates,r.watch?.quote,r.watch?.reference,r.batch?.plan,...r.batches.map(b=>b.plan)].filter(Boolean)){
   for(const pm of p.members){if(pm.id!==id&&!room.members.find(m=>m.id===pm.id)?.profile.shareBudget)pm.over=pm.over>0;}
  }
  return r;
 }
}

