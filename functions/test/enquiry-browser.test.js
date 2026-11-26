"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
const {randomUUID}=require("node:crypto");
const source=fs.readFileSync(path.resolve(__dirname,"../../assets/ccc-enquiry.js"),"utf8");
function setup({challenge=async()=>"verified-token",result={received:true,acknowledgementSent:true},preview=false}={}){
 const handlers={},calls=[],notices=[],button={disabled:false,textContent:"Send enquiry"};
 const status={hidden:true,replaceChildren(){notices.length=0;},append(el){notices.push(el.textContent);},classList:{toggle(){}},focus(){}};
 const fields={name:"Sample Writer",email:"writer@example.invalid",service:"Editing or proofreading",description:"An annual report that needs editing.",consent:"yes"};
 const form={dataset:{endpoint:preview?"":"https://function.example.invalid/enquiry"},elements:{},reportValidity:()=>true,addEventListener:(name,fn)=>{handlers[name]=fn;},querySelector:selector=>selector==="[data-form-status]"?status:selector==="[type=submit]"?button:null,reset(){}};
 const window={cccSpamCheck:challenge};
 const document={querySelector:()=>form,querySelectorAll:()=>[],createElement:()=>({textContent:""}),addEventListener(){}};
 class FormData{constructor(){}get(key){return fields[key]||null;}has(key){return key in fields;}}
 vm.runInNewContext(source,{window,document,FormData,crypto:{randomUUID},URL,URLSearchParams,location:{search:""},AbortController,setTimeout,clearTimeout,
  fetch:async(url,options)=>{calls.push({url,payload:JSON.parse(options.body)});return {ok:true,json:async()=>result};}});
 return {calls,notices,button,edit:()=>handlers.input(),submit:()=>handlers.submit({preventDefault(){}})};
}
test("the browser waits for verification before posting the enquiry and includes its token",async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});const s=setup({challenge:()=>pending});
 const submission=s.submit();assert.equal(s.calls.length,0);assert.equal(s.button.disabled,true);
 release("verified-token");await submission;assert.equal(s.calls.length,1);assert.equal(s.calls[0].payload.turnstileToken,"verified-token");
 assert.match(s.notices.join(" "),/has been received/);assert.equal(s.button.disabled,false);
});
test("failed or missing browser verification sends nothing and offers direct email",async()=>{
 for(const challenge of [undefined,async()=>{throw new Error("challenge-failed");}]){
  const s=setup({challenge:challenge===undefined?null:challenge});await s.submit();assert.equal(s.calls.length,0);assert.match(s.notices.join(" "),/spam check could not be completed/);assert.equal(s.button.disabled,false);
 }
});
test("the unconfigured review does not invoke verification or fetch",async()=>{
 let verifications=0;const s=setup({preview:true,challenge:async()=>{verifications++;return "token";}});await s.submit();
 assert.equal(verifications,0);assert.equal(s.calls.length,0);assert.match(s.notices.join(" "),/have not been sent/);
});
test("a server rejection is never presented as an accepted enquiry",async()=>{
 const s=setup({result:{error:"The spam check was rejected."}});await s.submit();assert.doesNotMatch(s.notices.join(" "),/has been received/);assert.match(s.notices.join(" "),/could not confirm/);
});
test("editing during a pending check does not send the older form snapshot",async()=>{
 let release;const s=setup({challenge:()=>new Promise(resolve=>{release=resolve;})});
 const pending=s.submit();s.edit();release("token");await pending;
 assert.equal(s.calls.length,0);assert.match(s.notices.join(" "),/changed during the spam check/);assert.equal(s.button.disabled,false);
});

const widgetSource=fs.readFileSync(path.resolve(__dirname,"../../assets/ccc-spam-check.js"),"utf8");
function widgetSetup({sitekey="configured-site-key",mode="success",loadFails=false}={}){
 const removed=[],scripts=[],mount={hidden:true,scrollIntoView(){}},form={dataset:{turnstileSitekey:sitekey},querySelector:()=>mount};
 let options;
 const api={render(element,config){assert.equal(element,mount);options=config;return "widget";},execute(id){assert.equal(id,"widget");queueMicrotask(()=>mode==="success"?options.callback("fresh-token"):options[mode]());},remove:id=>removed.push(id)};
 const window=loadFails?{}:{turnstile:api};
 const document={createElement:()=>({remove(){}}),head:{append(script){scripts.push(script);queueMicrotask(()=>script.onerror());}}};
 vm.runInNewContext(widgetSource,{window,document,Promise,Error,setTimeout,clearTimeout});
 return {run:()=>window.cccSpamCheck(form,"request-reference"),removed,scripts,mount,get options(){return options;}};
}
test("the widget binds the action and reference and is removed after issuing a token",async()=>{
 const s=widgetSetup();assert.equal(await s.run(),"fresh-token");assert.equal(s.options.action,"ccc-enquiry");assert.equal(s.options.cData,"request-reference");assert.equal(s.options.execution,"execute");assert.equal(s.options.appearance,"interaction-only");assert.deepEqual(s.removed,["widget"]);assert.equal(s.mount.hidden,true);
});
test("widget errors, expiry and interactive timeouts reject and clean up",async()=>{
 for(const mode of ["error-callback","expired-callback","timeout-callback"]){const s=widgetSetup({mode});await assert.rejects(s.run(),/spam-check-unconfirmed/);assert.deepEqual(s.removed,["widget"]);assert.equal(s.mount.hidden,true);}
});
test("a missing site key fails without loading an external script",async()=>{
 const s=widgetSetup({sitekey:""});await assert.rejects(s.run(),/spam-check-unconfigured/);assert.equal(s.scripts.length,0);
});
test("a blocked widget script rejects and loads only the official Turnstile URL",async()=>{
 const s=widgetSetup({loadFails:true});await assert.rejects(s.run(),/spam-check-unavailable/);assert.equal(s.scripts.length,1);assert.equal(s.scripts[0].src,"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");
});
