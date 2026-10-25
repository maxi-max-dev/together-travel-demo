// Browser-only showcase: all personas belong to one local sandbox, not real accounts.
import {GroupCore} from './group-core.mjs';
export const PREFIX='together-pages-v1';
export class DemoStore {
 constructor(storage,{clock=()=>Date.now()}={}) {this.storage=storage;this.clock=clock;}
 core(){return new GroupCore({clock:this.clock,
  token:()=>crypto.randomUUID(),
  // This is a demo lookup, deliberately not a security or user-authentication boundary.
  digest:value=>String(value||''),
  load:()=>JSON.parse(this.storage.getItem(PREFIX+':rooms')||'{}'),
  save:rooms=>this.storage.setItem(PREFIX+':rooms',JSON.stringify(rooms))
 });}
 remember(data){const auth={roomId:data.roomId,memberId:data.memberId,access:data.access};this.storage.setItem(`${PREFIX}:/trip/${auth.roomId}/${auth.memberId}`,JSON.stringify(auth));return data;}
 credentials(roomId,memberId){const a=JSON.parse(this.storage.getItem(`${PREFIX}:/trip/${roomId}/${memberId}`)||'null');if(!a)throw Error('这个示例成员还没有加入，请切回发起人加入体验。');return a;}
 async request(url,{method='GET',data={},credential}={}) {
  const core=this.core();core.check();
  if(url==='/api/v4/config')return {mode:'browser-showcase',orders:'simulation',shareBase:'',checkIntervalMs:15000};
  if(url==='/api/v4/trips'&&method==='POST')return this.remember(core.create(data));
  if(url==='/api/v4/invite-info')return core.inviteInfo(data.invite);
  if(url==='/api/v4/join')return this.remember(core.claim(data.invite,data.name));
  const match=url.match(/^\/api\/v4\/trips\/([a-f0-9-]+)(\/(?:actions|conversation))?$/);
  if(match)return method==='GET'?core.read(match[1],credential):match[2]==='/conversation'?core.conversation(match[1],credential,data):core.action(match[1],credential,data);
  throw Error('在线体验没有这个操作，也不会向真实订票接口发送请求。');
 }
 async persona(roomId,memberId){const core=this.core(),r=core.rooms[roomId],m=r?.members.find(m=>m.id===memberId);if(!m)throw Error('示例成员不存在');
  if(!m.joined)return this.remember(core.claim(m.inviteToken,m.name));
  const a=this.credentials(roomId,memberId);return {...a,room:core.read(roomId,a.access)};
 }
 async studio(count=2){
  const core=this.core(),owner=core.create({name:'小林',friend:'阿岚',destination:'上海',count,arrangement:'shared',arrivalMode:'independent'});this.remember(owner);const people=[owner];
  for(const m of core.rooms[owner.roomId].members.slice(1))people.push(this.remember(core.claim(m.inviteToken,m.name)));
  return people.map(a=>({...a,room:core.read(a.roomId,a.access)}));
 }
 async sample(kind='shared'){
  const partial=['partial','changed'].includes(kind),fullyJoined=partial||['shared','pricing'].includes(kind);
  const core=this.core(),count=kind==='solo'?1:partial?3:2;
  const owner=core.create({name:'小林',friend:'阿岚',destination:'杭州',count,arrangement:'organizer',arrivalMode:'independent'});this.remember(owner);
  const act=(a,action,data={})=>core.action(a.roomId,a.access,{revision:core.rooms[a.roomId].revision,action,data});
  const own=core.rooms[owner.roomId].members[0];act(owner,'profile',{name:own.name,profileRevision:0,profile:{...own.profile,payer:'self',budget:kind==='shared'?3400:4200}});
  if(kind==='organizer'){
   const m=core.rooms[owner.roomId].members[1];act(owner,'draft-profile',{memberId:m.id,name:m.name,profileRevision:0,profile:{...m.profile,payer:'organizer',budget:3600,brief:'组织者先整理：深圳出发，不坐红眼，预算3600。待本人确认。'}});
  }
  const creds=[owner];
  if(fullyJoined)for(const m of core.rooms[owner.roomId].members.slice(1)){const a=core.claim(m.inviteToken,m.name);this.remember(a);creds.push(a);const current=core.rooms[owner.roomId].members.find(m=>m.id===a.memberId);act(a,'profile',{name:current.name,profileRevision:0,profile:{...current.profile,payer:'self',budget:kind==='shared'?3400:4200},allowOrganizer:true,delegateFlex:true});}
  act(owner,'generate');const p=core.rooms[owner.roomId].candidates.find(p=>p.variant==='meet');if(p)act(owner,'choose',{planId:p.id});
  if(partial||kind==='pricing'){
   for(const a of creds)act(a,'consent',{accepted:true,planVersion:core.rooms[a.roomId].plan.version,cap:4200,target:4200,strategy:'budget',action:'prepare',maxShift:30,hotelSwap:false,flexGroup:true,advanceCap:12000,deadline:this.clock()+3600000});
   if(kind==='pricing'){
    act(owner,'scenario',{type:'missing'});
    // Settle the synthetic discount through actions, so it does not change mid-form.
    for(let i=0;i<3;i++)act(owner,'scenario',{type:'drop'});
    return {...owner,room:core.read(owner.roomId,owner.access)};
   }
   act(owner,'scenario',{type:'check'});
   for(const a of creds.slice(0,2)){const item=core.rooms[owner.roomId].batch.items.find(i=>i.ownerId===a.memberId&&i.kind==='out');act(a,'order',{itemId:item.id,operation:'pay'});}
   const last=creds[2],m=core.rooms[owner.roomId].members[2];act(owner,'draft-profile',{memberId:m.id,name:m.name,profileRevision:m.profileRevision,profile:{...m.profile,start:new Date(Date.parse(m.profile.start+'T12:00:00Z')+86400000).toISOString().slice(0,10),earliest:'08:00'},});
   if(kind==='changed'){
    const current=core.rooms[owner.roomId].members[2];
    act(last,'profile',{name:current.proposal.name,profileRevision:current.profileRevision,profile:current.proposal.profile});
    act(owner,'generate');
    const choices=core.rooms[owner.roomId].candidates;
    const replacement=choices.find(p=>p.variant===core.rooms[owner.roomId].plan.variant&&!p.lockedConflicts?.length)||choices.find(p=>!p.lockedConflicts?.length);
    if(!replacement)throw Error('改期案例没有可保留原付款的新方案');
    act(owner,'choose',{planId:replacement.id});
   }
  }
  return {...owner,room:core.read(owner.roomId,owner.access)};
 }
}
