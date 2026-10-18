// Conversation drafts are suggestions, never profile confirmation or booking authority.
export const destinations=['上海','成都','杭州','厦门'];
const has=(o,k)=>Object.hasOwn(o,k);
const dateOf=t=>new Date(t+8*3600000).toISOString().slice(0,10);
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00+08:00'))&&dateOf(Date.parse(s+'T00:00:00+08:00'))===s;
const validTime=s=>typeof s==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export function cleanDraft(input={}){
 const setup={},requirements={},s=input.setup||{},p=input.requirements||{};
 if(Number.isInteger(s.count)&&s.count>=1&&s.count<=6)setup.count=s.count;
 if(['organizer','shared'].includes(s.arrangement))setup.arrangement=s.arrangement;
 if(destinations.includes(s.destination))setup.destination=s.destination;
 if(typeof s.name==='string'&&s.name.trim())setup.name=s.name.trim().slice(0,20);
 if(typeof p.origin==='string'&&/^[\u4e00-\u9fa5]{2,12}$/.test(p.origin))requirements.origin=p.origin;
 for(const k of ['start','end'])if(validDate(p[k]))requirements[k]=p[k];
 for(const k of ['earliest','latest'])if(validTime(p[k]))requirements[k]=p[k];
 if(has(p,'budget')&&(p.budget===null||typeof p.budget==='number'&&Number.isFinite(p.budget)&&p.budget>0&&p.budget<=1000000))requirements.budget=p.budget;
 for(const k of ['noRedEye','directOnly'])if(typeof p[k]==='boolean')requirements[k]=p[k];
 if(Array.isArray(p.destinations)){const ds=[...new Set(p.destinations.filter(d=>destinations.includes(d)))];if(ds.length)requirements.destinations=ds;}
 if(typeof p.prefs==='string'&&p.prefs.trim())requirements.prefs=p.prefs.trim().slice(0,300);
 for(const k of ['likes','musts','avoids'])if(Array.isArray(p[k]))requirements[k]=[...new Set(p[k].filter(x=>typeof x==='string').map(x=>x.trim().slice(0,40)).filter(Boolean))].slice(0,8);
 return {setup,requirements};
}
export function mergeDraft(previous,next){return cleanDraft({setup:{...previous?.setup,...next?.setup},requirements:{...previous?.requirements,...next?.requirements}});}
export function nextQuestion(draft,{personal=false,now=Date.now()}={}){
 const s=draft.setup,p=draft.requirements;
 if(!personal&&!s.count)return {key:'count',text:'这趟一共几个人？可以先只说你自己的想法，朋友的条件等他们确认。'};
 if(!p.origin)return {key:'origin',text:'你自己从哪个城市出发？朋友的出发地可以稍后分别补充。'};
 if(!s.destination&&!p.destinations?.length)return {key:'destination',text:'想先聊哪个目的地？这版可以体验上海、成都、杭州、厦门。'};
 if(!p.start||!p.end)return {key:'dates',text:'你哪天能出发、哪天必须回来？可以说“10月23日到25日”。'};
 if(p.end<=p.start||Date.parse(p.start+'T00:00:00+08:00')<=now||Date.parse(p.end)-Date.parse(p.start)>7*86400000)return {key:'dates',text:'再核对一下日期：这版支持未来、一周以内、至少住一晚的旅行。你想哪天去、哪天回？'};
 if(!has(p,'budget'))return {key:'budget',text:'你个人这一趟的预算上限是多少？也可以说“先估价，不设预算”。'};
 if(!has(p,'directOnly')||!has(p,'noRedEye'))return {key:'flights',text:'航班有什么不能接受的？比如“只坐直飞，不坐红眼”，或“中转、夜间都可以”。'};
 return {key:'ready',text:'已经能整理一份条件草稿了。你还可以补充起降时间、想怎么玩，或者先打开条件核对；朋友仍需确认自己的条件。'};
}
export function draftSummary(draft){const s=draft.setup,p=draft.requirements;return [s.count?`${s.count} 人同行`:null,p.origin?`我从${p.origin}出发`:null,s.destination?`先去${s.destination}`:p.destinations?.length?`想去${p.destinations.join(' / ')}`:null,p.start&&p.end?`${p.start} — ${p.end}`:null,has(p,'budget')?p.budget===null?'先估价，不设上限':`我的整趟上限 ¥${p.budget.toLocaleString('zh-CN')}`:null,has(p,'directOnly')?p.directOnly?'只坐直达':'可以中转':null,has(p,'noRedEye')?p.noRedEye?'避开 23:00–06:00 起降':'可以夜间起降':null,p.earliest?`去程 ${p.earliest} 后起飞`:null,p.latest?`返程 ${p.latest} 前落地`:null,p.prefs,...['likes','musts','avoids'].map(k=>p[k]?.length?({likes:'想去',musts:'一定要去',avoids:'不想去'}[k]+'：'+p[k].join('、')):null)].filter(Boolean);}
const cities=['上海','深圳','北京','广州','武汉','南京','成都','杭州','厦门','重庆','西安','长沙','郑州','天津','苏州','昆明','青岛'];
const number=s=>({'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10}[s]??Number(s));
// Public Pages has no secrets or server. This deliberately bounded interpreter is labelled in the UI.
export function ruleTurn(state,text,{personal=false,now=Date.now()}={}){
 const input=text.trim(),previous=state.draft||cleanDraft(),pending=state.pending||nextQuestion(previous,{personal,now}).key;
 const setup={},requirements={},notices=[];
 const count=input.match(/([一二两三四五六七八九十\d]+)\s*(?:个?人|位)/);
 if(count&&!personal){const n=number(count[1]);if(n>=1&&n<=6)setup.count=n;else notices.push('这版最多支持6位成人；人数没有改成默认值。');}
 if(/(?:我一个人|自己去)/.test(input)&&!personal)setup.count=1;
 if(/(?:我来安排|我先帮|我帮大家)/.test(input))setup.arrangement='organizer';
 if(/(?:各自填|各自说)/.test(input))setup.arrangement='shared';
 const own=input.split(/[，,。；;\n]/).filter(x=>!/(?:朋友|他|她|对方|同事).*(?:预算|从|出发)/.test(x)||/^\s*我(?:自己)?(?:从|在|预算)/.test(x)).join('，');
 const origin=own.match(new RegExp('我(?:自己)?(?:从|在)('+cities.join('|')+')'))||((pending==='origin')&&input.match(new RegExp('^('+cities.join('|')+')(?:出发)?[。！! ]*$')));
 if(origin)requirements.origin=origin[1];
 const wanted=destinations.filter(d=>new RegExp('(?:想去|去|目的地[是为：:]?)[^，,。；;]{0,8}'+d).test(input));
 if(!wanted.length&&pending==='destination')for(const d of destinations)if(input===d)wanted.push(d);
 if(wanted.length){requirements.destinations=wanted;if(wanted.length===1)setup.destination=wanted[0];else notices.push('先选一个共同目的地，其他地点保留在个人候选里。');}
 if(/(?:我叫|叫我)/.test(own)){const n=own.match(/(?:我叫|叫我)([^，,。；;\s]{1,10})/);if(n)setup.name=n[1];}
 const iso=[...input.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map(x=>x[0]);
 if(iso.length>=2){requirements.start=iso[0];requirements.end=iso[1];}
 else {const ds=input.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[日号]?\s*(?:到|至|—|～|~|-)\s*(?:(\d{1,2})月)?(\d{1,2})[日号]?/);if(ds){const y=ds[1]||dateOf(now).slice(0,4),pad=n=>String(n).padStart(2,'0');requirements.start=`${y}-${pad(ds[2])}-${pad(ds[3])}`;requirements.end=`${y}-${pad(ds[4]||ds[2])}-${pad(ds[5])}`;}}
 if(/下(?:个)?周末/.test(input)){let d=Date.parse(dateOf(now)+'T00:00:00+08:00');const weekday=new Date(d+8*3600000).getUTCDay();d+=((8-(weekday||7))%7+4)*86400000;if(d<=now)d+=7*86400000;requirements.start=dateOf(d);requirements.end=dateOf(d+2*86400000);notices.push(`“下个周末”暂按 ${requirements.start} 至 ${requirements.end}，请核对。`);}
 const budget=own.match(/(?:我(?:的)?(?:个人)?|个人|每人)\s*(?:整趟)?(?:预算|上限)?\s*(?:是|为|最多|不超过|控制在|改成|改为|调整到)?\s*(\d+(?:\.\d+)?)\s*([千kK万])?/)
  ||(!/(?:总|全组|合计|大家)/.test(own)&&own.match(/(?:预算|上限)\s*(?:是|为|改成|改为|调整到)?\s*(\d+(?:\.\d+)?)\s*([千kK万])?/))
  ||((pending==='budget'&&!/(?:总|大家|一起|合计|他|她|朋友)/.test(input))&&input.match(/^(?:预算)?\s*(\d+(?:\.\d+)?)\s*([千kK万])?\s*(?:元|块)?[。！! ]*$/));
 if(budget)requirements.budget=Number(budget[1])*({'千':1000,k:1000,K:1000,'万':10000}[budget[2]]||1);
 if(/(?:不设预算|预算不限|先估价|不设上限)/.test(own))requirements.budget=null;
 if(/只(?:坐|要)?(?:直飞|直达)|不(?:接受|坐)?(?:中转|转机|经停)/.test(own))requirements.directOnly=true;
 else if(/(?:中转|转机|经停).*(?:可以|接受|都行)|可以(?:中转|转机)/.test(own))requirements.directOnly=false;
 if(/不(?:坐|要|接受)?红眼|避开红眼/.test(own))requirements.noRedEye=true;
 else if(/(?:红眼|夜间).*(?:可以|接受|都行)|可以(?:坐)?红眼/.test(own))requirements.noRedEye=false;
 if(pending==='flights'&&/^(?:航班不限|都可以|都行|没有限制)[。！! ]*$/.test(input)){requirements.directOnly=false;requirements.noRedEye=false;}
 const time=(s)=>{const m=s.match(/(\d{1,2})(?::|点)(\d{2})?/);return m?`${String(Number(m[1])).padStart(2,'0')}:${m[2]||'00'}`:null;};
 const earliest=own.match(/(?:最早|出发|去程)?[^，,。；;]{0,8}?\d{1,2}(?::|点)\d{0,2}(?:以?后|之后)(?:才能|能|可以)?起飞/);
 const latest=own.match(/(?:返程|回来|回程)?[^，,。；;]{0,8}?\d{1,2}(?::|点)\d{0,2}(?:以?前|之前)(?:必须|要)?(?:落地|到家)/);
 if(earliest)requirements.earliest=time(earliest[0]);
 if(latest&&!/到家/.test(latest[0]))requirements.latest=time(latest[0]);
 if(/下班|到家/.test(own))notices.push('下班、到家时间和机场起降不同，需在条件核对里留出路程。');
 if(/慢慢逛|吃点|美食|博物馆|海边|日落|不赶|轻松|购物|看展/.test(own))requirements.prefs=own.slice(0,300);
 for(const [k,label] of [['likes','想去'],['musts','一定要去'],['avoids','不想去']]){const m=own.match(new RegExp('(?:^|[，,])'+label+'[：:]?([^，,。；;]+)'));if(m)requirements[k]=m[1].split(/[、/]/).map(x=>x.trim());}
 const draft=mergeDraft(previous,{setup,requirements}),next=nextQuestion(draft,{personal,now});
 const answer=flowAnswer(input);
 const changed=JSON.stringify(draft)!==JSON.stringify(previous);
 return {draft,pending:next.key,answer:[answer,notices.join(' '),changed?'已放进草稿，尚未确认。':answer?'':'这段还没形成新的条件；演练版可以按下面的问题补充，也可以直接核对表单。',next.text].filter(Boolean).join('\n'),source:'rules'};
}

export function flowAnswer(input){
 let answer='';
 if(/预算.*(?:包含|包括|算什么)|(?:包括|包含).*预算/.test(input))answer='个人整趟预算会一起计算交通、住宿分摊和生活预留；已经模拟付款的费用及退订损失也计入。';
 else if(/(?:会|能|直接|自动).*(?:扣钱|扣款|支付|买票)|(?:真的|真实)下单/.test(input))answer='这版不会扣款，订单和付款都是模拟。真实数据模式还需完整核价，才有可能进入模拟交接。';
 else if(/(?:朋友|每人|各自).*(?:预算|条件).*(?:不同|不一样)|(?:可以|能).*(?:预算|条件).*不同/.test(input))answer='可以。每个人分别确认自己的城市、日期、预算和限制；共同方案要同时满足这些条件。';
 else if(/红眼.*(?:什么|意思)/.test(input))answer='这版“不坐红眼”指避开23:00至次日06:00起降。确认前可以调整这项限制。';
 else if(/(?:支持|可以|能).*(?:截图|语音)/.test(input))answer='当前先支持文字。截图和语音尚未接入，可以把关键信息用几句话发来。';
 return answer;
}
