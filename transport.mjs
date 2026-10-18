import {DemoStore,PREFIX} from './demo-store.mjs';
const store=new DemoStore(localStorage);
const exclusive=fn=>navigator.locks?navigator.locks.request(PREFIX,fn):Promise.resolve().then(fn);
export const transport={
 isShowcase:true,storagePrefix:PREFIX,home:'./',
 path:()=>location.hash.startsWith('#trip/')?'/'+location.hash.slice(1):'/',
 urlFor:path=>path==='/'?'./':'#'+path.replace(/^\//,''),
 setRoute:(view,path)=>history.replaceState({view},'',path?'#'+path.replace(/^\//,''):undefined),
 request:(url,options)=>exclusive(()=>store.request(url,options)),
 sample:kind=>exclusive(()=>store.sample(kind)),
 studio:count=>exclusive(()=>store.studio(count)),
 persona:(roomId,memberId)=>exclusive(()=>store.persona(roomId,memberId))
};
