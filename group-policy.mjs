// Pure rules shared by Node and the browser sandbox. All inventory is synthetic.
const DAY=86400000;
const day=t=>new Date(t+8*3600000).toISOString().slice(0,10);
const midnight=d=>Date.parse(d+'T00:00:00+08:00');
export function paidOrders(room) {
 const map=new Map();
 for(const item of [...(room.retainedOrders||[]),...(room.batch?.items||[])])if(item.status==='paid')map.set(item.id,item);
 return [...map.values()];
}
export const travelerId=item=>item.travelerId||item.ownerId;
export const itemKey=item=>item.kind==='hotel'?'hotel':`${travelerId(item)}:${item.kind}`;
export function payerFor(room,memberId){return room.members.find(m=>m.id===memberId)?.profile.payer==='organizer'?room.ownerId:memberId;}
export function lodging(room,members,nightly) {
 const groups=new Map();
 members.forEach((m,i)=>{
  const key=room.roomMode==='single'?`单间${i+1}`:room.roomMode==='assigned'?(room.roomGroups?.[m.id]||`单间${i+1}`):`双床${Math.floor(i/2)+1}`;
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(m);
 });
 const shares=Object.fromEntries(members.map(m=>[m.id,0])),allocations=[];let roomNights=0;
 for(const [label,occupants] of groups){
  if(occupants.length>2)throw Error('每个房间最多两人，请修改房间分组');
  const start=day(Math.min(...occupants.map(m=>m.out.endAt))),end=day(Math.max(...occupants.map(m=>m.back.startAt)));
  let nights=0;
  for(let t=midnight(start);t<midnight(end);t+=DAY){
   const active=occupants.filter(m=>t>=midnight(day(m.out.endAt))&&t<midnight(day(m.back.startAt)));
   if(!active.length)continue;nights++;roomNights++;
   active.forEach((m,i)=>shares[m.id]+=Math.floor(nightly/active.length)+(i<nightly%active.length?1:0));
  }
  allocations.push({label,memberIds:occupants.map(m=>m.id),start,end,nights});
 }
 const total=roomNights*nightly;
 if(room.splitMode!=='nights')members.forEach((m,i)=>shares[m.id]=Math.floor(total/members.length)+(i<total%members.length?1:0));
 return {total,shares,allocations,roomNights,rooms:groups.size,key:JSON.stringify(allocations)};
}
export function attachLedger(room,p) {
 const stay=lodging(room,p.members,p.hotel.nightly);
 p.rooms=stay.rooms;p.roomNights=stay.roomNights;p.hotel.allocations=stay.allocations;p.hotel.key=`${p.hotel.id}:${stay.key}`;
 p.hotel.shares=stay.shares;p.hotel.baseTotal=stay.total;
 if(p.hotel.total!==null)p.hotel.total=stay.total;
 p.members.forEach(m=>{m.stayStart=day(m.out.endAt);m.stayEnd=day(m.back.startAt);m.stayNights=(midnight(m.stayEnd)-midnight(m.stayStart))/DAY;m.payerId=payerFor(room,m.id);m.lossShare=(room.losses||[]).filter(l=>l.travelerId===m.id).reduce((n,l)=>n+l.amount,0);});
}
export function orderSpec(p,m,kind) {
 if(kind==='hotel')return {key:p.hotel.key||JSON.stringify([p.hotel.id,p.start,p.end,p.rooms]),amount:p.hotel.total};
 return {key:m[kind].id,amount:m[kind].price};
}
export function paidConflicts(room,p) {
 return paidOrders(room).flatMap(item=>{
  const m=p.members.find(m=>m.id===travelerId(item));
  const before=room.batch?.plan||room.plan;
  const oldMember=before?.members.find(m=>m.id===travelerId(item));
  const expected=item.productKey||(before&&orderSpec(before,oldMember,item.kind).key);
  const current=(item.kind==='hotel'||m)?orderSpec(p,m,item.kind):null;
  return current&&current.key===expected?[]:[{id:item.id,label:item.label,ownerId:item.ownerId,amount:item.amount,fee:Math.ceil(item.amount*(item.kind==='hotel'?.1:.2)),reason:'已付款项目与新安排冲突，需付款人先处理模拟退订'}];
 });
}
export function agreementKey(room){return JSON.stringify([room.destination,room.roomMode,room.roomGroups||{},room.splitMode,room.reserve,room.minHours,room.maxWait,room.arrivalMode,room.ideas.map(i=>[i.id,i.title,i.votes])]);}
export function canCarryConsent(room,m,c,before,after,now) {
 if(!c||!before||c.deadline<=now||c.profileRevision!==(m.profileRevision||0))return false;
 if(c.byId&&c.byId!==m.id&&(!m.delegation||m.delegation.until<=now))return false;
 const a=before.members.find(x=>x.id===m.id),b=after.members.find(x=>x.id===m.id);
 if(c.agreementKey!==agreementKey(room))return false;
 const reference=before.mode==='live'&&after.mode==='live'&&!before.completePrice&&!after.completePrice;
 if(!a||!b||before.destination!==after.destination)return false;
 if(reference){if(!Number.isFinite(b.estimateTotal)||b.estimateTotal>c.cap||a.hotelEstimate!==b.hotelEstimate)return false;}
 else if(b.total===null||b.total>c.cap)return false;
 if(before.hotel.id!==after.hotel.id&&(reference||!c.hotelSwap))return false;
 const roomFor=(p,id)=>{const r=(p.hotel.allocations||[]).find(r=>r.memberIds.includes(id));return r?{label:r.label,memberIds:r.memberIds,start:r.start,end:r.end,nights:r.nights}:null;};
 if(JSON.stringify(roomFor(before,m.id))!==JSON.stringify(roomFor(after,m.id))||a.hotelShare!==b.hotelShare||a.payerId!==b.payerId)return false;
 if(c.advanceCap!==undefined&&m.id===room.ownerId){const amount=reference?after.cash?.find(x=>x.id===m.id)?.estimateAmount:after.members.filter(x=>x.payerId===m.id).reduce((sum,x)=>sum+x.transport,after.hotel.total);if(!Number.isFinite(amount)||amount>c.advanceCap)return false;}
 if(!c.flexGroup&&(before.meetAt!==after.meetAt||before.leaveAt!==after.leaveAt))return false;
 if(after.hours<room.minHours)return false;
 return ['out','back'].every(d=>a[d].from===b[d].from&&a[d].to===b[d].to&&day(a[d].startAt)===day(b[d].startAt)&&Math.abs(a[d].startAt-b[d].startAt)<=c.maxShift*60000&&Math.abs(a[d].endAt-b[d].endAt)<=c.maxShift*60000);
}
