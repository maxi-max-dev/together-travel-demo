import {transport} from './transport.mjs';
const params=new URLSearchParams(location.search),count=[1,2,3].includes(Number(params.get('people')))?Number(params.get('people')):2;
let device=params.get('device')==='desktop'?'desktop':'phone';
const target=document.querySelector('#studio-frames'),status=document.querySelector('#studio-status');
if(!transport.isShowcase){location.replace(transport.urlFor('/rehearsal/studio.html')+location.search);}
else{
 const drawDevices=()=>{target.dataset.device=device;document.querySelectorAll('[data-device]').forEach(b=>b.classList.toggle('selected',b.dataset.device===device));};
 const start=async(fresh=false)=>{
  status.textContent='正在打开独立成员视角…';target.replaceChildren();
  const key=transport.storagePrefix+':studio:'+count;
  let people;try{if(!fresh)people=JSON.parse(localStorage.getItem(key));if(people)people=await Promise.all(people.map(p=>transport.persona(p.roomId,p.memberId)));}catch{people=null;}
  if(!people){people=await transport.studio(count);localStorage.setItem(key,JSON.stringify(people.map(({roomId,memberId})=>({roomId,memberId}))));}
  for(const [i,p] of people.entries()){
   const article=document.createElement('article');article.className='studio-person';
   const heading=document.createElement('header'),label=document.createElement('strong'),hint=document.createElement('span');
   label.textContent=['小林 · 成都出发','阿岚 · 北京出发','同行 3 · 自己补充'][i];hint.textContent='建议场景，尚未填入或确认';heading.append(label,hint);
   const frame=document.createElement('iframe');frame.title=label.textContent+'的个人对话';frame.src='./'+transport.urlFor(`/trip/${p.roomId}/${p.memberId}`);article.append(heading,frame);target.append(article);
  }
  status.textContent=`${count} 个独立成员视角 · 输入确认后，另外的窗口会同步共同进度`;
  drawDevices();
 };
 document.querySelectorAll('[data-people]').forEach(b=>{b.classList.toggle('selected',Number(b.dataset.people)===count);b.onclick=()=>{location.href='./studio.html?people='+b.dataset.people+'&device='+device;};});
 document.querySelectorAll('[data-device]').forEach(b=>b.onclick=()=>{device=b.dataset.device;drawDevices();history.replaceState(null,'','?people='+count+'&device='+device);});
 document.querySelector('#restart').onclick=()=>start(true).catch(e=>status.textContent=e.message);
 start().catch(e=>status.textContent=e.message);
}
