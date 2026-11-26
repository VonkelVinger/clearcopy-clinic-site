(function(){
"use strict";
let loading;
function load(){
 if(window.turnstile)return Promise.resolve(window.turnstile);
 if(loading)return loading;
 loading=new Promise((resolve,reject)=>{
  const script=document.createElement("script"),timer=setTimeout(()=>{script.remove();reject(new Error("spam-check-unavailable"));},15000);
  script.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";script.async=true;
  script.onload=()=>{clearTimeout(timer);window.turnstile?resolve(window.turnstile):reject(new Error("spam-check-unavailable"));};
  script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error("spam-check-unavailable"));};
  document.head.append(script);
 }).catch(error=>{loading=null;throw error;});
 return loading;
}
window.cccSpamCheck=async function(form,reference){
 const sitekey=(form.dataset.turnstileSitekey||"").trim(),mount=form.querySelector("[data-spam-check]");
 if(!sitekey||!mount)throw new Error("spam-check-unconfigured");
 const api=await load();mount.hidden=false;
 return new Promise((resolve,reject)=>{
  let widget,settled=false;
  const timer=setTimeout(()=>finish(null),60000);
  function finish(token){
   if(settled)return;settled=true;clearTimeout(timer);
   if(widget!==undefined)api.remove(widget);
   mount.hidden=true;
   if(token)resolve(token);else reject(new Error("spam-check-unconfirmed"));
  }
  try{
   widget=api.render(mount,{sitekey,action:"ccc-enquiry",cData:reference,execution:"execute",appearance:"interaction-only",size:"compact",retry:"never",
    callback:token=>finish(token),"error-callback":()=>{finish(null);return true;},"expired-callback":()=>finish(null),"timeout-callback":()=>finish(null),
    "before-interactive-callback":()=>mount.scrollIntoView({block:"center"})});
   api.execute(widget);
  }catch{finish(null);}
 });
};
})();
