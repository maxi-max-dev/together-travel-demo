// Shared, manual observations only. These records never verify provider inventory,
// complete a quote, alter a budget, or authorize an order.
const copy=value=>structuredClone(value);
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
const requireThat=(ok,message,status=400)=>{if(!ok)fail(message,status);};
const text=(value,max)=>String(value??'').trim().slice(0,max);
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=10000000;
const finite=value=>Number.isFinite(value)?value:null;
const dateTime=value=>Number.isFinite(value)?new Date(value+8*3600000).toISOString().slice(0,16).replace('T',' '):'时间待补';
const CHECKS=[
 {key:'productMatched',label:'日期、班次或房型、人数与本方案一致'},
 {key:'totalIncludesFees',label:'已核对含税费的完整总额'},
 {key:'availabilityChecked',label:'已在来源页面查看对应人数或房数是否可选'},
 {key:'termsChecked',label:'已阅读退改与取消规则'}
];
export const HANDOFF_NOTICE='以下是成员共享的人工核价记录，不是供应商核验、库存保证、预算放行或有效票据；下单与付款继续模拟。';

export function handoffSourceUrl(value){
 if(typeof value!=='string'||!value.trim()||value.length>2048)return '';
 try{const u=new URL(value.trim());
  if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||!/(^|\.)(feizhu|fliggy)\.com$/.test(u.hostname))return '';
  return u.href;
 }catch{return '';}
}

function currentPlan(room){
 const p=room.plan;
 if(!p||!Array.isArray(p.members)||!p.hotel)return null;
 const q=room.watch?.quote;
 return q&&q.version===p.version&&q.conditionVersion===p.conditionVersion&&Array.isArray(q.members)&&q.hotel?q:p;
}
function flightFacts(f={}){
 return {id:text(f.id,240),flight:text(f.flight||f.label,100),from:text(f.from,40),to:text(f.to,40),fromStation:text(f.fromStation,80),toStation:text(f.toStation,80),startAt:finite(f.startAt),endAt:finite(f.endAt),price:finite(f.price),stops:finite(f.stops),segments:finite(f.segments),journeys:finite(f.journeys),priceBasis:text(f.priceBasis,200)};
}
function hotelFacts(p){
 const h=p.hotel;
 return {id:text(h.id,240),key:text(h.key,12000),name:text(h.name,120),start:text(p.start,20),end:text(p.end,20),rooms:finite(p.rooms),roomNights:finite(p.roomNights),roomMode:text(p.roomMode,30),total:finite(h.total),estimateTotal:finite(h.estimateTotal),priceBasis:text(h.priceBasis,200),allocations:(h.allocations||[]).map(a=>({label:text(a.label,80),memberIds:Array.isArray(a.memberIds)?a.memberIds.map(x=>text(x,80)):[],start:text(a.start,20),end:text(a.end,20),nights:finite(a.nights),quote:a.quote?{id:text(a.quote.id||a.quote.providerId,240),name:text(a.quote.name,120),price:finite(a.quote.price)}:null}))};
}
function specs(room,p,viewerId){
 const result=[];
 for(const m of p.members){
  for(const kind of ['out','back']){
   const f=m[kind];if(!f)continue;
   const facts=flightFacts(f);
   result.push({key:`${m.id}:${kind}`,kind,memberId:m.id,assignedTo:m.id,label:`${m.name} · ${kind==='out'?'去程':'返程'}`,identity:JSON.stringify(facts),details:[`${facts.from} → ${facts.to}`,`${dateTime(facts.startAt)} — ${dateTime(facts.endAt)} · 北京时间`,`${facts.flight||'班次待核'} · 1 位成人`],sourceUrl:handoffSourceUrl(f.url),canEdit:m.id===viewerId,checks:[...CHECKS,{key:'baggageChecked',label:'已核对行李额度与附加费用'}]});
  }
 }
 const facts=hotelFacts(p),source=facts.allocations.length?(p.hotel.allocations||[]).map(a=>handoffSourceUrl(a.quote?.url)).find(Boolean):'';
 result.push({key:'hotel',kind:'hotel',memberId:null,assignedTo:room.ownerId,label:'共同住宿 · 全程全部房间',identity:JSON.stringify(facts),details:[facts.name||'酒店待核',`${facts.start} — ${facts.end} · ${facts.rooms??'待核'} 间 / ${facts.roomNights??'待核'} 房晚`,...facts.allocations.map(a=>`${a.label}：${a.start} — ${a.end}，${a.memberIds.length} 人`)],sourceUrl:handoffSourceUrl(p.hotel.url)||source||'',canEdit:room.ownerId===viewerId,checks:CHECKS});
 return result;
}
function cleanChecks(value,allowed=[...CHECKS,{key:'baggageChecked'}]){return Object.fromEntries(allowed.map(c=>[c.key,value?.[c.key]===true]));}
function cleanRecord(r){
 return {id:text(r.id,80),itemKey:text(r.itemKey,100),itemLabel:text(r.itemLabel,150),identity:text(r.identity,24000),planVersion:r.planVersion,conditionVersion:r.conditionVersion,total:positive(r.total)?r.total:null,sourceUrl:handoffSourceUrl(r.sourceUrl),checks:cleanChecks(r.checks,r.itemKey==='hotel'?CHECKS:undefined),note:text(r.note,500),at:finite(r.at),byId:text(r.byId,80),byName:text(r.byName,40),details:Array.isArray(r.details)?r.details.map(x=>text(x,300)).slice(0,10):[],invalidatedAt:finite(r.invalidatedAt)};
}
function gaps(item,record){
 if(!record)return ['尚未保存人工核价记录'];
 return [...(!positive(record.total)?['含税费完整总额']:[]),...(!handoffSourceUrl(record.sourceUrl)?['飞猪来源链接']:[]),...item.checks.filter(c=>record.checks?.[c.key]!==true).map(c=>c.label)];
}
const bindingMatches=(r,p,item)=>r.planVersion===p.version&&r.conditionVersion===p.conditionVersion&&r.itemKey===item.key&&r.identity===item.identity;
const currentVersion=(room,p)=>!!p&&Number.isInteger(p.version)&&p.version>0&&Number.isInteger(p.conditionVersion)&&p.conditionVersion>0&&p.conditionVersion===room.conditionVersion;
const invalidated=record=>Number.isFinite(record?.invalidatedAt);

// Run only at state-write boundaries. Once observed stale, an observation stays
// historical even if a later price/product happens to return to its old value.
export function reconcileHandoff(room,now=Date.now()){
 if(!Array.isArray(room.handoffRecords)||!room.handoffRecords.length)return false;
 const p=currentPlan(room),valid=currentVersion(room,p),items=new Map(valid?specs(room,p,room.ownerId).map(i=>[i.key,i]):[]);
 let changed=false;
 for(const record of room.handoffRecords){
  if(!record||typeof record!=='object'||invalidated(record))continue;
  const item=items.get(record.itemKey);
  if(!valid||!item||!bindingMatches(record,p,item)){record.invalidatedAt=now;changed=true;}
 }
 return changed;
}

export function listHandoff(room,viewerId){
 const p=currentPlan(room),valid=currentVersion(room,p);
 const history=(Array.isArray(room.handoffRecords)?room.handoffRecords:[]).filter(r=>r&&typeof r==='object').map(cleanRecord);
 const selected=new Set();
 const items=p?specs(room,p,viewerId).map(item=>{
  const latest=history.find(r=>r.itemKey===item.key);
  const current=valid&&latest&&!invalidated(latest)&&bindingMatches(latest,p,item)?latest:null;
  const previous=current?history.find(r=>r.itemKey===item.key&&r.id!==current.id):latest;
  if(current)selected.add(current.id);
  const missing=gaps(item,current),status=current?(missing.length?'partial':'recorded'):previous?'stale':'missing';
  return {...item,canEdit:valid&&item.canEdit,record:current||null,previousRecord:previous||null,status,missing};
 }):[];
 const completed=items.filter(i=>i.status==='recorded').length;
 const any=items.some(i=>i.record);
 const status=!p?'no-plan':!valid?'stale-plan':items.length&&completed===items.length?'recorded':any?'partial':'needs-check';
 const knownTotal=items.reduce((sum,i)=>sum+(i.record?.total||0),0);
 const total=status==='recorded'?Math.round(knownTotal*100)/100:null;
 const mine=items.filter(i=>i.canEdit&&i.status!=='recorded');
 const nextStep=status==='no-plan'?'先选择共同方案，再核对每项商品。':status==='stale-plan'?'出行条件已变化，先重新安排；旧记录仅保留作参考。':status==='recorded'?'人工条目已录齐，可以导出交接清单；在飞猪下单前仍需重新核对实时价格、库存和本人预算。':mine.length?`继续核对你负责的 ${mine.length} 项；可以先保存已知部分，缺项会继续标出。`:'你的人工条目已录齐，等待其他成员补齐，再导出交接清单。';
 const result={status,planVersion:p?.version??null,conditionVersion:p?.conditionVersion??null,items,completed,total,knownTotal:Math.round(knownTotal*100)/100,nextStep,notice:HANDOFF_NOTICE,history:history.filter(r=>!selected.has(r.id))};
 // Explicit allowlist: never spread room, profiles, private chat or consent caps here.
 result.export={title:text(room.title,100),destination:text(p?.destination||room.destination,40),planVersion:result.planVersion,conditionVersion:result.conditionVersion,status,total,notice:HANDOFF_NOTICE,nextStep,items:items.map(i=>({key:i.key,label:i.label,details:copy(i.details),status:i.status,missing:copy(i.missing),assignedToName:text(room.members?.find(m=>m.id===i.assignedTo)?.name,40),record:i.record?{total:i.record.total,sourceUrl:i.record.sourceUrl,checks:cleanChecks(i.record.checks,i.checks),note:i.record.note,at:i.record.at,byName:i.record.byName}:null}))};
 return result;
}

export function saveHandoff(room,viewerId,input={},now=Date.now()){
 const actor=room.members?.find(m=>m.id===viewerId&&m.joined);
 requireThat(actor,'成员不存在或尚未领取邀请',403);
 const p=currentPlan(room);
 requireThat(currentVersion(room,p),'条件或方案版本不完整，请先选择当前方案再核价',409);
 requireThat(input.planVersion===p.version&&input.conditionVersion===p.conditionVersion,'核价方案版本已变化，请查看最新方案后再保存',409);
 const item=specs(room,p,viewerId).find(i=>i.key===input.itemKey);
 requireThat(item,'核价项目不存在',404);
 requireThat(item.canEdit,item.kind==='hotel'?'共同住宿由发起人记录':'请由这段交通对应的本人记录',403);
 requireThat(typeof input.identity==='string'&&input.identity===item.identity,'商品、日期或参考报价已经变化，请重新核对后保存',409);
 requireThat(Number.isFinite(now),'无法记录核价时间');
 const latest=(Array.isArray(room.handoffRecords)?room.handoffRecords:[]).find(r=>r?.itemKey===item.key);
 const previous=latest&&!invalidated(latest)&&bindingMatches(latest,p,item)?latest:null;
 const has=key=>Object.prototype.hasOwnProperty.call(input,key);
 let total=has('total')?input.total:previous?.total??null;
 if(total===''||total===null)total=null;
 else{requireThat(typeof total==='number'||(typeof total==='string'&&total.trim()!==''),'请填写有效的含费总额');total=Number(total);requireThat(positive(total),'含费总额需为 0 以上、10000000 以下的有限数值');requireThat(Math.abs(total*100-Math.round(total*100))<0.00001,'含费总额最多保留两位小数');}
 const rawUrl=has('sourceUrl')?input.sourceUrl:previous?.sourceUrl??'';
 requireThat(typeof rawUrl==='string','请填写飞猪来源链接');
 const sourceUrl=rawUrl.trim()?handoffSourceUrl(rawUrl):'';
 requireThat(!rawUrl.trim()||sourceUrl,'来源链接须为 HTTPS 飞猪 / Fliggy 页面，且不能含登录凭据');
 if(has('checks')){requireThat(input.checks&&typeof input.checks==='object'&&!Array.isArray(input.checks),'请逐项核对勾选状态');for(const c of item.checks)if(Object.prototype.hasOwnProperty.call(input.checks,c.key))requireThat(typeof input.checks[c.key]==='boolean','核价勾选项必须明确选择');}
 const checks=cleanChecks({...previous?.checks,...input.checks},item.checks);
 const record={id:globalThis.crypto.randomUUID(),itemKey:item.key,itemLabel:item.label,identity:item.identity,planVersion:p.version,conditionVersion:p.conditionVersion,total,sourceUrl,checks,note:has('note')?text(input.note,500):text(previous?.note,500),at:now,byId:viewerId,byName:text(actor.name,40),details:copy(item.details)};
 // Append history instead of editing an earlier observation; all writes are versioned.
 room.handoffRecords=[record,...(Array.isArray(room.handoffRecords)?room.handoffRecords:[])];
 return {record:copy(record),status:gaps(item,record).length?'partial':'recorded'};
}
