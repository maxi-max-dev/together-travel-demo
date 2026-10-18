import {paidOrders,travelerId,payerFor,attachLedger,orderSpec,paidConflicts,canCarryConsent,agreementKey} from './group-policy.mjs';
// v4 domain logic. Every fare, timetable, lodging and order is synthetic.
const randomUUID=()=>globalThis.crypto.randomUUID();

export const CHECK_MS = 15000;
export const ORDER_MS = 15 * 60000;
export const clone = value => structuredClone(value);
const DAY = 86400000;
export function fail(message, status=400) { const e=new Error(message); e.status=status; throw e; }
const requireThat=(ok,message,status=400)=>{if(!ok)fail(message,status);};
export const at=(date,time='00:00')=>Date.parse(`${date}T${time}:00+08:00`);
export const dateOf=time=>new Date(time+8*3600000).toISOString().slice(0,10);
export const timeOf=time=>new Date(time+8*3600000).toISOString().slice(11,16);
const dayAfter=(date,n=1)=>dateOf(at(date)+n*DAY);
const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(at(d))&&dateOf(at(d))===d;
const validTime=t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const bounded=(n,min,max,label)=>{n=Number(n);requireThat(Number.isFinite(n)&&n>=min&&n<=max,`${label}需要在 ${min}–${max} 之间`);return n;};
const text=(x,max=100)=>String(x??'').trim().slice(0,max);
export function weekend(now=Date.now()) {
 let d=at(dateOf(now));while(new Date(d+8*3600000).getUTCDay()!==5||d<=now+DAY)d+=DAY;
 return {start:dateOf(d),end:dateOf(d+2*DAY)};
}
export function defaults(index=0, dates=weekend()) {
 return {origin:['上海','深圳','北京','广州','武汉','南京'][index%6],...dates,earliest:'18:00',latest:'22:00',budget:3400,shareBudget:false,noRedEye:true,directOnly:true,destinations:['上海','成都','杭州','厦门'],prefs:'慢慢逛，吃点当地的',brief:'',remember:false};
}
export function log(room,message,now=Date.now(),kind='info') {
 room.events.unshift({id:randomUUID(),at:now,message,kind});room.events=room.events.slice(0,160);
}
export function invalidate(room,reason,now=Date.now()) {
 if(room.plan&&room.plan.conditionVersion===room.conditionVersion)room.previousPlan=clone(room.plan);
 room.changeReason=reason;room.candidates=[];room.conditionVersion++;
 room.priorConsents??={};for(const m of room.members){if(m.consent)room.priorConsents[m.id]=clone(m.consent);m.consent=null;}
 if(room.watch){room.watch.status='needs-decision';room.watch.nextCheckAt=null;}
 if(room.batch&&room.batch.items.some(x=>!['cancelled','expired'].includes(x.status)))room.batch.needsReview=true;
 room.stage=room.plan?'needs-decision':'collecting';
 log(room,reason,now,'decision');
}
function member(room,id) {const m=room.members.find(x=>x.id===id&&x.joined);requireThat(m,'成员不存在或尚未领取邀请',403);return m;}
const owner=(room,id)=>requireThat(room.ownerId===id,'只有发起人可以修改这项共同设置',403);
export const preferenceList=value=>[...new Set((Array.isArray(value)?value:typeof value==='string'?value.split(/[、,，;；\n]/):[]).map(x=>text(x,40)).filter(Boolean))].slice(0,8);
export function preferenceConflicts(room){
 const people=room.members.filter(m=>m.confirmed),key=s=>s.normalize('NFKC').toLowerCase().replace(/\s/g,'');
 const conflicts=[];for(const m of people)for(const place of m.profile.musts||[])for(const other of people)if((other.profile.avoids||[]).some(x=>key(x)===key(place)))conflicts.push(`“${place}”存在必去与不去的分歧（${m.name} / ${other.name}）`);
 return [...new Set(conflicts)];
}
export function profilePatch(room,id,input,now=Date.now()) {
 const m=member(room,id),p=input.profile||{};
 requireThat(input.profileRevision===(m.profileRevision||0),'你的条件已在另一个页面更新，请查看最新内容后再提交。',409);
 requireThat(validDate(p.start)&&validDate(p.end)&&p.end>p.start,'请选择有效的出发和返回日期，至少住一晚');
 requireThat(at(p.end)-at(p.start)<=7*DAY,'本轮支持一周以内的旅行');
 requireThat(at(p.start)>now,'请选择未来的出发日期');
 requireThat(validTime(p.earliest)&&validTime(p.latest),'请填写有效的出发与返回时刻');
 requireThat(text(input.name,20),'请填写称呼');requireThat(text(p.origin,20),'请填写出发城市');
 const destinations=Array.isArray(p.destinations)?p.destinations.map(x=>text(x,20)).filter(Boolean):[];
 requireThat(destinations.length>0&&destinations.length<=8,'至少选择一个能接受的目的地');
 const profile={payer:p.payer==='organizer'?'organizer':'self',origin:text(p.origin,20),start:p.start,end:p.end,earliest:p.earliest,latest:p.latest,
  budget:p.budget===null?null:bounded(p.budget,1,1000000,'个人预算'),shareBudget:p.shareBudget===true,
  likes:preferenceList(p.likes),musts:preferenceList(p.musts),avoids:preferenceList(p.avoids),
  noRedEye:p.noRedEye===true,directOnly:p.directOnly===true,destinations,prefs:text(p.prefs,300),brief:text(p.brief,3000),remember:p.remember===true};
 const changed=JSON.stringify(profile)!==JSON.stringify(m.profile)||input.name!==m.name;
 if(changed||room.plan)invalidate(room,`${m.name}更新了本次条件，需要重新核对共同安排。`,now);
 m.name=text(input.name,20);m.profile=profile;m.confirmed=true;m.confirmedAt=now;m.profileRevision=(m.profileRevision||0)+1;
 m.memory=profile.remember?{prefs:profile.prefs,noRedEye:profile.noRedEye,directOnly:profile.directOnly,confirmedAt:now}:null;
 delete m.proposal;
 if(input.allowOrganizer===true){requireThat(profile.budget!==null,'委托组织者前，请明确个人预算上限');m.delegation={byId:room.ownerId,cap:profile.budget,until:at(profile.start,profile.earliest),flexGroup:input.delegateFlex===true,profileRevision:m.profileRevision};}
 else m.delegation=null;
 log(room,`${m.name}已亲自确认本次条件${m.delegation?'，并授予组织者有限代办权限':''}。`,now);
}
const VARIANTS=[
 {id:'save',title:'把预算留给玩',tag:'少花一点',price:260,hotel:'街角小住',out:'18:00',back:'14:00',fare:570},
 {id:'meet',title:'多一点相聚时间',tag:'更好会合',price:380,hotel:'巷子里的周末',out:'19:00',back:'17:00',fare:660},
 {id:'slow',title:'住舒服，慢慢逛',tag:'更舒适',price:520,hotel:'河畔慢居',out:'20:00',back:'18:00',fare:750}
];
function flightValid(f,p,direction) {
 if(!f)return false;
 if(f.startAt<at(p.start,p.earliest)||f.endAt>at(p.end,p.latest))return false;
 if(p.directOnly&&f.stops>0)return false;
 if(p.noRedEye&&[f.startAt,f.endAt].some(t=>timeOf(t)<'06:00'||timeOf(t)>='23:00'))return false;
 return direction==='out'||f.to===p.origin;
}
function makeFlight(m,index,direction,day,variant,room,previous) {
 const p=m.profile,out=direction==='out',paid=paidOrders(room).find(i=>travelerId(i)===m.id&&i.kind===direction),paidPlan=room.batch?.plan||room.plan;
 const fixed=paid&&(paid.product||paidPlan?.members.find(x=>x.id===m.id)?.[direction]);
 if(fixed&&flightValid(fixed,p,direction)&&fixed.from===(out?p.origin:room.destination)&&fixed.to===(out?room.destination:p.origin))return {...clone(fixed),price:paid.amount,basePrice:paid.amount,paidOrderId:paid.id};
 const old=previous?.members.find(x=>x.id===m.id)?.[direction];
 const notBefore=out?room.disruptions?.[m.id]:null;
 if(old&&(!notBefore||old.startAt>=notBefore)&&old.from===(out?p.origin:room.destination)&&old.to===(out?room.destination:p.origin)&&flightValid(old,p,direction))return clone(old);
 const preferred=variant[out?'out':'back'];
 const slots=['06:30','08:00','11:00','14:00','17:00','18:00','19:00','20:00','20:30'];
 const possible=[];
 for(const shift of out?[0,1]:[0])for(const slot of slots) {
  const date=dayAfter(day,shift),startAt=at(date,slot)+(out&&variant.id==='save'?index*10*60000:0),endAt=startAt+120*60000;
  const f={id:`SIM-${m.id}-${direction}-${date}-${timeOf(startAt)}`,from:out?p.origin:room.destination,to:out?room.destination:p.origin,startAt,endAt,stops:0,
   basePrice:variant.fare+index*55+(out?0:40),price:variant.fare+index*55+(out?0:40),label:`示例直达 ${out?'去程':'返程'}`,station:room.destination+'示例机场',transferMinutes:60};
  if((!notBefore||f.startAt>=notBefore)&&flightValid(f,p,direction))possible.push(f);
 }
 const target=at(day,preferred);
 possible.sort((a,b)=>Math.abs(a.startAt-target)-Math.abs(b.startAt-target));
 return possible[0]||null;
}
export function inputsReady(room) {
 const errors=preferenceConflicts(room);
 if(room.members.length<1)errors.push('至少需要一位出行者');
 for(const m of room.members){if(!m.joined)errors.push(`等${m.name}领取邀请`);else if(!m.confirmed)errors.push(`等${m.name}确认条件`);else if(!m.profile.destinations.includes(room.destination))errors.push(`${m.name}尚未接受${room.destination}`);}
 for(const idea of room.ideas){const votes=room.members.map(m=>idea.votes[m.id]||'pending');if(votes.includes('pending'))errors.push(`“${idea.title}”还需所有人表态`);if(votes.includes('must')&&votes.includes('avoid'))errors.push(`“${idea.title}”存在必去与不去的分歧`);}
 return errors;
}
export function calculate(room,now=Date.now(),preserve=false,preview=false) {
 const pending=inputsReady(room),errors=preview?pending.filter(e=>e.includes('分歧')||e.includes('尚未接受')):pending;if(errors.length)return {plans:[],errors};
 const start=room.members.map(m=>m.profile.start).sort().at(-1),end=room.members.map(m=>m.profile.end).sort()[0];
 if(start>=end)return {plans:[],errors:['大家的日期没有覆盖至少一晚，请协商出发或返回日期。']};
 const rooms=room.roomMode==='single'?room.members.length:Math.ceil(room.members.length/2);
 const plans=[];
 for(const v of VARIANTS){
  const prior=room.batch?.plan||room.watch?.quote||room.plan;
  const previous=preserve&&prior?.variant===v.id?prior:null;
  const members=room.members.map((m,i)=>({id:m.id,name:m.name,out:makeFlight(m,i,'out',room.arrivalMode==='independent'?m.profile.start:start,v,room,previous),back:makeFlight(m,i,'back',room.arrivalMode==='independent'?m.profile.end:end,v,room,previous),reserve:room.reserve}));
  if(members.some(m=>!m.out||!m.back))continue;
  if(room.arrivalMode!=='independent'&&Math.max(...members.map(m=>m.out.endAt))-Math.min(...members.map(m=>m.out.endAt))>room.maxWait*60000){
   const latest=members.reduce((a,b)=>a.out.startAt>b.out.startAt?a:b).out;
   for(let i=0;i<members.length;i++)if(latest.endAt-members[i].out.endAt>room.maxWait*60000){
    members[i].out=makeFlight(room.members[i],i,'out',dateOf(latest.startAt),{...v,out:timeOf(latest.startAt)},room,null);
   }
   if(members.some(m=>!m.out))continue;
  }
  const hotelStart=dateOf(Math.min(...members.map(m=>m.out.endAt))),hotelEnd=dateOf(Math.max(...members.map(m=>m.back.startAt))),nights=Math.round((at(hotelEnd)-at(hotelStart))/DAY);
  if(nights<1)continue;
  const meetAt=Math.max(...members.map(m=>m.out.endAt+60*60000)),leaveAt=Math.min(...members.map(m=>m.back.startAt-150*60000));
  const hours=Math.max(0,Math.round((leaveAt-meetAt)/360000)/10),waitMinutes=Math.round((Math.max(...members.map(m=>m.out.endAt))-Math.min(...members.map(m=>m.out.endAt)))/60000);
  if(hours<room.minHours||(room.arrivalMode!=='independent'&&waitMinutes>room.maxWait))continue;
  const hotelTotal=v.price*rooms*nights;
  const p={id:randomUUID(),variant:v.id,title:previous?'尽量保留原安排':v.title,tag:previous?'最小调整':v.tag,destination:room.destination,start:hotelStart,end:hotelEnd,nights,rooms,preview:pending.length>0,pendingConfirmations:pending,
   roomMode:room.roomMode,hotel:{id:'SIM-HOTEL-'+v.id,name:room.destination+' · '+v.hotel,nightly:v.price,total:hotelTotal,baseTotal:hotelTotal,cancellable:true},
   members,meetAt,leaveAt,hours,waitMinutes,quotedAt:now,conditionVersion:room.conditionVersion,mode:'simulation'};
  attachLedger(room,p);recost(room,p);p.lockedConflicts=paidConflicts(room,p);plans.push(p);
 }
 return {plans,errors:plans.length?[]:['当前合成班次无法同时满足出发限制、会合等待和共同时间。请协商条件；这不代表真实无票。']};
}
export function recost(room,p) {
 const hotel=p.hotel.total,shares=p.hotel.shares;
 p.members.forEach((m,i)=>{
  m.hotelShare=hotel===null?null:(shares?.[m.id]??Math.floor(hotel/p.members.length)+(i<hotel%p.members.length?1:0));
  m.transport=m.out.price+m.back.price;m.lossShare=(room.losses||[]).filter(l=>l.travelerId===m.id).reduce((n,l)=>n+l.amount,0);
  m.total=m.hotelShare===null?null:m.transport+m.hotelShare+m.reserve+m.lossShare;
  m.payerId=payerFor(room,m.id);
  const profile=room.members.find(x=>x.id===m.id)?.profile;m.over=m.total!==null&&profile?.budget!==null?Math.max(0,m.total-profile.budget):0;
 });
 p.total=p.members.some(m=>m.total===null)?null:p.members.reduce((n,m)=>n+m.total,0);
 p.feasible=p.total!==null&&p.members.every(m=>m.over===0);
 p.cash=p.members.map(m=>({id:m.id,amount:hotel===null?null:p.members.filter(x=>x.payerId===m.id).reduce((n,x)=>n+x.transport,0)+(m.id===room.ownerId?hotel:0)}));
}
function differences(before,after) {
 if(!before)return [];
 return after.members.map(m=>{const p=before.members.find(x=>x.id===m.id);return {id:m.id,name:m.name,priceDelta:m.total!==null&&p?.total!==null?m.total-(p?.total||0):null,
  estimateDelta:Number.isFinite(m.estimateTotal)&&Number.isFinite(p?.estimateTotal)?m.estimateTotal-p.estimateTotal:null,
  outChanged:!p||p.out.id!==m.out.id,backChanged:!p||p.back.id!==m.back.id,oldOut:p?.out.startAt,newOut:m.out.startAt,oldBack:p?.back.startAt,newBack:m.back.startAt};});
}
function startWatch(room,now) {
 const interval=room.dataMode==='live'?(room.liveIntervalMs||1800000):CHECK_MS;
 const p=room.plan;if(inputsReady(room).length||!room.members.every(m=>m.consent?.planVersion===p?.version))return;
 if(room.watch){if(room.watch.status!=='paused'){room.watch.status='watching';room.watch.nextCheckAt=now+interval;room.stage='watching';}return;}
 room.watch={status:'watching',startedAt:now,lastSuccessAt:null,nextCheckAt:now+interval,checks:0,discount:0,failOnce:false,missingHotel:false,quote:clone(p),reference:clone(p),error:null,stopBy:null};
 room.stage='watching';log(room,room.dataMode==='live'?`授权已齐，服务运行时每 ${interval/60000} 分钟复查真实候选；缺少完整核价时不会准备订单。`:'授权已齐，服务端开始每 15 秒检查一次合成行情；关闭页面也可继续。',now);
}
export function choose(room,id,now=Date.now()) {
 const p=room.candidates.find(p=>p.id===id);requireThat(p&&p.conditionVersion===room.conditionVersion,'方案已变化，请重新生成');
 requireThat(paidConflicts(room,p).length===0,'新方案与已付款项目冲突，请付款人先核对模拟退订损失；其他已付项目保留。');
 const old=room.batch?.plan||room.watch?.quote||room.plan||room.previousPlan;
 const consents={...room.priorConsents};for(const m of room.members)if(m.consent)consents[m.id]=clone(m.consent);
 room.retainedOrders=paidOrders(room).map(clone);
 if(room.batch){const history=clone(room.batch);for(const i of history.items)if(i.status==='pending'){i.status='cancelled';i.superseded=true;}room.batches.unshift(history);room.batch=null;}
 room.plan=clone(p);room.plan.version=++room.planVersion;room.plan.changes=differences(old,p);room.plan.sharedChanges=old?{oldRoomNights:old.roomNights||old.rooms*old.nights,newRoomNights:p.roomNights||p.rooms*p.nights,oldNights:old.nights,newNights:p.nights,oldHours:old.hours,newHours:p.hours,oldRooms:old.rooms,newRooms:p.rooms}:null;room.previousPlan=old?clone(old):null;
 room.plan.confirmations=room.members.map(m=>{const c=consents[m.id],keep=!p.preview&&canCarryConsent(room,m,c,old,p,now);m.consent=keep?{...c,planVersion:room.plan.version,carriedFrom:c.planVersion}:null;return {id:m.id,name:m.name,kept:keep,reason:keep?'个人安排仍在已同意范围内':'条件、费用、共同时间或授权需要确认'};});
 delete room.priorConsents;room.watch=null;room.stage='awaiting-consent';room.changeReason='';
 log(room,`已提出方案 v${room.plan.version}，保留 ${room.retainedOrders.length} 项已付款；${room.members.filter(m=>!m.consent).length} 位需要确认。`,now,'decision');startWatch(room,now);
}
export function consent(room,id,input,now=Date.now()) {
 const m=member(room,id),p=room.plan;requireThat(p&&p.conditionVersion===room.conditionVersion,'先重新生成并选择有效方案');
 requireThat(input.planVersion===p.version,'你看到的方案版本已变化，请先查看新方案',409);
 requireThat(input.accepted===true,'请明确同意方案及本人授权范围');
 requireThat(!room.batch,'先处理现有预订清单，不能重复建立委托');
 requireThat(m.confirmed,'先确认本人的条件');requireThat(inputsReady(room).length===0,'还有成员或共同愿望未确认');
 const cap=bounded(input.cap,1,1000000,'执行上限'),target=input.strategy==='budget'?cap:bounded(input.target,1,cap,'目标价');
 requireThat(m.profile.budget===null||cap<=m.profile.budget,'执行上限超过本人预算，请先修改本次条件');
 requireThat(['notify','prepare'].includes(input.action),'请选择提醒或准备模拟清单');
 const maxShift=bounded(input.maxShift,0,180,'可接受时间变化');
 const deadline=Number(input.deadline);requireThat(Number.isFinite(deadline)&&deadline>now&&deadline<Math.min(...p.members.map(m=>m.out.startAt)),'委托截止应在当前时间之后、第一人出发之前');
 const requiredAdvance=p.cash?.find(x=>x.id===id)?.amount||0;
 const advanceCap=bounded(input.advanceCap??requiredAdvance,0,10000000,'垫付上限');
 requireThat(id!==room.ownerId||advanceCap>=requiredAdvance,'垫付上限不足以支付当前清单，请重新选择付款分工或方案');
 m.consent={agreementKey:agreementKey(room),planVersion:p.version,cap,target,strategy:input.strategy==='budget'?'budget':'target',action:input.action,maxShift,hotelSwap:input.hotelSwap===true,flexGroup:input.flexGroup===true,advanceCap,profileRevision:m.profileRevision||0,deadline,at:now,byId:input.byId||id};
 log(room,input.byId&&input.byId!==id?`${member(room,input.byId).name}按有效授权代${m.name}确认方案 v${p.version}。`:`${m.name}已确认方案 v${p.version} 及本人的委托范围。`,now);
 startWatch(room,now);
}

function withinScope(room,quote) {
 const ref=room.watch.reference;
 return quote.members.every(m=>{const original=ref.members.find(x=>x.id===m.id),actor=room.members.find(x=>x.id===m.id),c=actor.consent;
  return original&&c&&flightValid(m.out,actor.profile,'out')&&flightValid(m.back,actor.profile,'back')&&['out','back'].every(d=>dateOf(m[d].startAt)===dateOf(original[d].startAt)&&Math.abs(m[d].startAt-original[d].startAt)<=c.maxShift*60000&&Math.abs(m[d].endAt-original[d].endAt)<=c.maxShift*60000);})&&
  (quote.hotel.id===ref.hotel.id||room.members.every(m=>m.consent.hotelSwap))&&(room.arrivalMode==='independent'||quote.waitMinutes<=room.maxWait)&&quote.hours>=room.minHours;
}
export function buildOrders(room,now) {
 if(room.batch)return;
 if(room.dataMode==='live'&&(!room.watch?.quote?.completePrice||room.watch.quote.total===null))fail('完整报价与库存尚未核实，不能准备待付款清单');
 const p=room.watch.quote,retained=paidOrders(room);
 const make=(m,kind)=>{
  const spec=orderSpec(p,m,kind),saved=retained.find(i=>i.kind===kind&&(kind==='hotel'||travelerId(i)===m.id));
  if(saved)return {...clone(saved),retained:true};
  const hotel=kind==='hotel';return {id:randomUUID(),travelerId:hotel?null:m.id,ownerId:hotel?room.ownerId:payerFor(room,m.id),label:hotel?`共同住宿 · ${p.roomNights} 房晚`:`${m.name} · ${kind==='out'?'去程':'返程'}`,kind,productKey:spec.key,product:hotel?clone(p.hotel):clone(m[kind]),amount:spec.amount,status:hotel&&room.failHotelOnce?'failed':'pending',deadline:now+ORDER_MS,attempts:1};
 };
 const items=[...p.members.flatMap(m=>['out','back'].map(d=>make(m,d))),make(null,'hotel')];
 room.failHotelOnce=false;room.batch={id:randomUUID(),planVersion:p.version,createdAt:now,mode:'simulation',needsReview:false,items,plan:clone(p)};room.retainedOrders=[];
 room.stage=items.every(i=>i.status==='paid')?'completed':'orders';room.watch.status=room.stage;room.watch.nextCheckAt=null;
 log(room,`已准备 ${items.length} 项模拟清单，其中 ${items.filter(i=>i.status==='paid').length} 项已付保留；没有真实占位或扣款。`,now,'ready');
}
export function tick(room,now=Date.now(),force=false) {
 let changed=false;
 if(room.batch){for(const i of room.batch.items)if(i.status==='pending'&&i.deadline<=now){i.status='expired';changed=true;log(room,`${i.label}的模拟付款时限已过，其他项目状态保留。`,now,'decision');}}
 const w=room.watch;if(!w||!['watching','ready','waiting-activity','waiting-data'].includes(w.status))return changed;
 if(room.members.some(m=>!m.consent||m.consent.deadline<=now)){w.status='expired';w.nextCheckAt=null;room.stage='expired';log(room,'已到达成员设定的最早决策截止，停止跟进。请重新约定条件或结束委托。',now,'decision');return true;}
 // Live polling is asynchronous and owned by GroupService; never apply synthetic discounts here.
 if(room.dataMode==='live')return changed;
 if(!force&&w.nextCheckAt>now)return changed;
 w.checks++;w.nextCheckAt=now+CHECK_MS;
 if(w.failOnce){w.failOnce=false;w.error='本次模拟查询失败，将在下一次检查重试';w.status='waiting-data';log(room,w.error,now,'warning');return true;}
 w.error=null;w.lastSuccessAt=now;w.discount=Math.min(360,w.discount+40);
 const q=clone(w.quote);
 q.members.forEach(m=>{for(const d of ['out','back'])if(!m[d].paidOrderId)m[d].price=Math.max(200,m[d].basePrice-w.discount);});
 const lockedHotel=paidOrders(room).find(i=>i.kind==='hotel');q.hotel.total=lockedHotel?lockedHotel.amount:w.missingHotel?null:q.hotel.baseTotal;q.quotedAt=now;recost(room,q);
 q.meetAt=Math.max(...q.members.map(m=>m.out.endAt+60*60000));q.leaveAt=Math.min(...q.members.map(m=>m.back.startAt-150*60000));q.hours=Math.max(0,Math.round((q.leaveAt-q.meetAt)/360000)/10);q.waitMinutes=Math.round((Math.max(...q.members.map(m=>m.out.endAt))-Math.min(...q.members.map(m=>m.out.endAt)))/60000);
 w.quote=q;
 if(!withinScope(room,q)){w.status='needs-decision';w.nextCheckAt=null;room.stage='needs-decision';room.changeReason='新班次超出预授权范围，需要重新选择并确认。';room.previousPlan=clone(room.plan);room.conditionVersion++;room.candidates=[];room.members.forEach(m=>m.consent=null);log(room,room.changeReason,now,'decision');return true;}
 if(q.total===null){w.status='waiting-data';log(room,'酒店价格缺失，保留已知费用，暂停整趟准备。',now,'warning');return true;}
 if(room.ideas.some(i=>Object.values(i.votes).includes('must')&&!i.ready)){w.status='waiting-activity';log(room,'机酒已检查；必去项目尚未落实，继续等待。',now);return true;}
 const fits=q.members.every(m=>{const c=room.members.find(x=>x.id===m.id).consent;return m.total<=c.cap&&m.total<=(c.strategy==='budget'?c.cap:c.target)&&m.over===0;});
 const ownerConsent=room.members.find(m=>m.id===room.ownerId).consent;
 const advance=q.cash?.find(x=>x.id===room.ownerId)?.amount||0;
 if(!fits||advance>(ownerConsent?.advanceCap??Infinity)){w.status='watching';log(room,`第 ${w.checks} 次检查完成，仍未同时满足所有人的目标。`,now);return true;}
 if(room.members.every(m=>m.consent.action==='prepare'))buildOrders(room,now);
 else {const was=w.status;w.status='ready';room.stage='ready';if(was!=='ready')log(room,'整趟条件已满足；至少一位成员仅授权提醒，等待共同决定下一步。',now,'ready');}
 return true;
}
export function orderAction(room,id,input,now=Date.now()) {
 const b=room.batch||{items:room.retainedOrders||[],plan:room.plan};requireThat(b.items.length,'还没有预订清单');const item=b.items.find(i=>i.id===input.itemId);requireThat(item,'项目不存在');requireThat(item.ownerId===id,'只有这项的付款人可以操作',403);
 if(input.operation==='pay') {
  requireThat(!b.needsReview&&b.planVersion===room.plan?.version&&room.plan?.conditionVersion===room.conditionVersion,'条件已变化，先处理旧预订单');
  requireThat(!b.items.some(i=>['failed','expired','cancelled'].includes(i.status)||(i.status==='pending'&&i.deadline<=now)),'清单有失败、过期或取消项，请先补齐再付款');
  requireThat(!room.members.some(m=>!m.consent||m.consent.deadline<=now),'委托已过期或撤回，先处理旧预订单');
  requireThat(item.status==='pending'&&item.deadline>now,'这项已处理或过期，请先刷新');
  item.status='paid';item.paidAt=now;log(room,`${item.label}已模拟付款，没有实际扣款。`,now);
  if(b.items.every(i=>i.status==='paid')){room.stage='completed';room.watch.status='completed';log(room,'全部模拟预订已完成，出行清单已整理好。',now,'ready');}
 }else if(input.operation==='retry'){
  requireThat(!b.needsReview,'先处理条件变化，不能重建旧方案的预订单');
  requireThat(['failed','expired','cancelled'].includes(item.status),'仅失败、过期或取消项可以重试');
  requireThat(!room.members.some(m=>!m.consent||m.consent.deadline<=now),'委托已到期，请重新安排');
  item.status='pending';item.deadline=now+ORDER_MS;item.attempts++;
  if(b.items.every(i=>['pending','paid'].includes(i.status))){room.stage='orders';room.watch.status='orders';}
  log(room,`${item.label}已重新准备，其他项目保持原状态。`,now);
 }else if(input.operation==='cancel'){
  requireThat(['pending','paid','failed'].includes(item.status),'这项已结束，无需重复取消');
  const paid=item.status==='paid';
  if(paid){requireThat(input.confirmLoss===true,'请先确认模拟退订损失，已付款项目不会自动全额退回');const fee=Math.ceil(item.amount*(item.kind==='hotel'?.1:.2));item.refundFee=fee;item.refundedAmount=item.amount-fee;room.losses??=[];
   const people=item.kind==='hotel'?b.plan.members:[{id:travelerId(item)}];people.forEach((m,i)=>room.losses.push({orderId:item.id,travelerId:m.id,payerId:item.ownerId,amount:Math.floor(fee/people.length)+(i<fee%people.length?1:0)}));
  }
  item.status='cancelled';item.cancelledAt=now;room.stage='needs-decision';if(paid){room.refunds??=[];room.refunds.push(clone(item));}
  log(room,`${item.label}已模拟${paid?'退订，扣除模拟损失 ¥'+item.refundFee:'取消'}；真实退改规则尚未接入。`,now,'decision');
  if(paid)invalidate(room,'已有付款发生模拟退订，需将损失计入新方案并重新核对。',now);
 }else fail('未知清单操作');
}
export function perform(room,id,action,input={},now=Date.now()) {
 member(room,id);
 if(action==='profile')return profilePatch(room,id,input,now);
 if(action==='draft-profile'){
  owner(room,id);const target=room.members.find(m=>m.id===input.memberId);requireThat(target&&target.id!==id,'请选择同行者');
  requireThat(Number(input.profileRevision)===(target.profileRevision||0),'同行者条件刚更新，请重新读取再提交草稿',409);
  const temporary=clone(room),draft=temporary.members.find(m=>m.id===target.id);draft.joined=true;
  profilePatch(temporary,target.id,{...input,allowOrganizer:false,profileRevision:target.profileRevision||0},now);
  const proposed=temporary.members.find(m=>m.id===target.id);
  if(target.confirmed){target.proposal={name:proposed.name,profile:proposed.profile,at:now,byId:id};log(room,`已向${target.name}提出修改建议，原条件继续生效，等待本人核对。`,now);}
  else{target.name=proposed.name;target.profile=proposed.profile;target.profileRevision=(target.profileRevision||0)+1;target.draftedBy=id;invalidate(room,`已为${target.name}整理条件草稿，仍待本人确认。`,now);}return;
 }
 if(action==='delegation-revoke') {const m=member(room,id);m.delegation=null;invalidate(room,`${m.name}撤销组织者代办权限，等待本人重新确认。`,now);delete room.priorConsents[id];return;}
 if(action==='consent-for'){
  owner(room,id);const m=member(room,input.memberId),d=m.delegation;
  requireThat(d&&d.byId===id&&d.until>now&&d.profileRevision===(m.profileRevision||0),'该成员没有有效的组织者代办授权',403);
  requireThat(Number(input.cap)<=d.cap&&Number(input.maxShift)<=30&&!input.hotelSwap&&(!input.flexGroup||d.flexGroup),'超出该成员授予的预算或调整范围',403);
  requireThat(Number(input.deadline)<=d.until,'委托截止超过代办有效期');
  return consent(room,m.id,{...input,byId:id},now);
 }
 if(action==='end-wait') {requireThat(room.watch,'没有跟进任务');room.watch.status='stopped';room.watch.nextCheckAt=null;room.stage='stopped';room.members.forEach(m=>m.consent=null);room.priorConsents={};if(room.batch)room.batch.needsReview=true;log(room,`${member(room,id).name}结束了这次等待，原方案与已付款记录保留。`,now);return;}

 if(action==='settings') {
  owner(room,id);requireThat(Number(input.settingsVersion)===(room.settingsVersion||0),'共同设置已经修改，请查看最新内容后再提交。',409);const destination=text(input.destination,20);requireThat(['上海','成都','杭州','厦门'].includes(destination),'请选择示例目的地');
  requireThat(['twin','single','assigned'].includes(input.roomMode),'请选择住宿方式');
  const reserve=bounded(input.reserve,0,10000,'每人生活预留'),minHours=bounded(input.minHours,1,96,'最少共同时间'),maxWait=bounded(input.maxWait,0,720,'最长会合等待');
  const roomGroups={};for(const m of room.members)roomGroups[m.id]=text(input['room-'+m.id]||room.roomGroups?.[m.id]||'单间-'+m.name,24);
  if(input.roomMode==='assigned')for(const value of Object.values(roomGroups))requireThat(Object.values(roomGroups).filter(v=>v===value).length<=2,'每个房间最多两人');
  invalidate(room,'共同安排已修改，重新核对每人的住宿、费用及授权。',now);Object.assign(room,{destination,roomMode:input.roomMode,roomGroups,splitMode:input.splitMode==='equal'?'equal':'nights',arrivalMode:input.arrivalMode==='independent'?'independent':'together',reserve,minHours,maxWait,settingsVersion:(room.settingsVersion||0)+1});return;
 }
 if(action==='idea-add'){
  const title=text(input.title,100);requireThat(title,'请写下想去的地方或想做的事');requireThat(room.ideas.length<16,'先整理已有愿望，最多保留 16 项');
  invalidate(room,`${member(room,id).name}新增了一个共同愿望。`,now);room.ideas.push({id:randomUUID(),title,by:id,source:text(input.source,400),votes:{[id]:'like'},ready:false});return;
 }
 if(action==='idea-vote'){
  const idea=room.ideas.find(i=>i.id===input.ideaId);requireThat(idea,'愿望不存在');requireThat(['must','like','neutral','avoid'].includes(input.vote),'请选择自己的意见');
  invalidate(room,`${member(room,id).name}更新了“${idea.title}”的意见。`,now);idea.votes[id]=input.vote;return;
 }
 if(action==='idea-ready') {owner(room,id);const idea=room.ideas.find(i=>i.id===input.ideaId);requireThat(idea,'愿望不存在');idea.ready=input.ready===true;log(room,`“${idea.title}”${idea.ready?'已模拟落实':'改为待落实'}。`,now);if(room.batch&&!idea.ready){room.batch.needsReview=true;room.stage='needs-decision';log(room,'必去项目状态变化，暂停预订交接并保留已有订单。',now,'decision');}return;}
 if(action==='generate'){
  const result=calculate(room,now,true,true);room.candidates=result.plans;room.planErrors=result.errors;
  log(room,result.plans.length?'已按每个人的条件重新计算共同方案。':'暂未生成可行示例方案，请处理显示的缺口。',now,result.plans.length?'info':'decision');return;
 }
 if(action==='choose')return choose(room,input.planId,now);
 if(action==='consent')return consent(room,id,input,now);
 if(action==='pause') {requireThat(room.watch&&!['orders','completed','expired','stopped'].includes(room.watch.status),'当前没有可暂停的跟进');room.watch.status='paused';room.watch.pausedBy=id;room.watch.nextCheckAt=null;room.stage='paused';log(room,`${member(room,id).name}暂停了共同委托。`,now);return;}
 if(action==='resume') {requireThat(room.watch?.status==='paused','当前没有暂停');requireThat(room.watch.pausedBy===id,'由暂停的成员恢复，或重新共同授权',403);room.watch.status='watching';room.watch.nextCheckAt=now;room.stage='watching';log(room,'已恢复委托，下次检查会重新核对全部条件。',now);return;}
 if(action==='withdraw') {const m=member(room,id);m.consent=null;if(room.priorConsents)delete room.priorConsents[id];if(room.watch){room.watch.status='stopped';room.watch.nextCheckAt=null;}if(room.batch)room.batch.needsReview=true;room.stage='stopped';log(room,`${m.name}撤回了委托；停止后续动作，已有模拟单仍需处理。`,now,'decision');return;}
 if(action==='order')return orderAction(room,id,input,now);
 if(action==='memory-clear'){member(room,id).memory=null;member(room,id).profile.remember=false;return;}
 if(action==='scenario') {
  owner(room,id);const w=room.watch;
  if(input.type==='hotel-fail'){room.failHotelOnce=true;log(room,'演练设置：下一次酒店准备将失败。',now);return;}
  if(input.type==='order-expire'){requireThat(room.batch,'先生成模拟清单');for(const item of room.batch.items)if(item.status==='pending')item.deadline=now-1;tick(room,now);return;}
  requireThat(w&&['watching','ready','waiting-data','waiting-activity'].includes(w.status),'先建立正在跟进的委托');
  if(input.type==='failure')w.failOnce=true;
  else if(input.type==='missing')w.missingHotel=true;
  else if(input.type==='restore')w.missingHotel=false;
  else if(input.type==='drop')w.discount=Math.min(360,w.discount+100);
  else if(input.type==='shift-small'||input.type==='shift-large'){
   const first=w.quote.members[0],f=first.out,delta=(input.type==='shift-small'?15:180)*60000;f.startAt+=delta;f.endAt+=delta;f.id+='-ALT';room.disruptions={...room.disruptions,[first.id]:f.startAt};log(room,`演练：首位成员的去程推迟 ${delta/60000} 分钟。`,now);
  }else if(input.type!=='check')fail('未知演练事件');
  tick(room,now,true);return;
 }
 fail('未知操作');
}
