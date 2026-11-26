"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const { validate,messages }=require("../enquiry-input");
const { createHandler }=require("../enquiry-handler");
const { createStore }=require("../enquiry-store");
const valid={requestId:"52c95f34-bab2-4168-bb7d-8a772f136349",turnstileToken:"test-token",name:"Sample Writer",email:"writer@example.invalid",service:"Book suitability check",description:"A practical book about running a small publication.",projectStage:"Partial manuscript",wordCount:8000,consent:true,campaigns:{utm_source:"X"},selfCheck:{project_stage:"started manuscript",concept_summary:"A practical book.",audience_types:["professionals"]}};
function response(){return {headers:{},set(k,v){this.headers[k]=v;return this;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;}};}
function setup({kind="new",adminFails=false,ackFails=false,config=true,challenge="verified",verificationThrows=false}={}){
 const sent=[],stored=[],logs=[],verified=[];let reserveCalls=0;
 const handler=createHandler({
  getConfig:()=>config?{pepper:"test-pepper",host:"smtp.example.invalid",user:"test",password:"test",turnstileSecret:"test-secret"}:{},
  async verifyChallenge(value){verified.push(value);if(verificationThrows)throw new Error("private-challenge-error");return {kind:challenge};},
  store:{async reserve(value){reserveCalls++;stored.push(value);return {kind};},async finish(...args){stored.push(args);},async fail(id){stored.push(["failed",id]);}},
  async sendMail(mail){sent.push(mail);if((sent.length===1&&adminFails)||(sent.length===2&&ackFails))throw new Error("private-email-error");},
  log:{info:x=>logs.push(x),error:x=>logs.push(x)}
 });
 async function invoke({body=valid,origin="https://clearcopy.clinic",method="POST",json=true}={}){
  const res=response();await handler({body,method,ip:"192.0.2.44",get:k=>k==="origin"?origin:undefined,is:t=>json&&t==="application/json"},res);return res;
 }
 return {invoke,sent,stored,logs,verified,get reserveCalls(){return reserveCalls;}};
}
test("accepts the full enquiry and carried self-check without changing source wording",()=>{
 const result=validate(valid);assert.equal(result.data.selfCheck.concept_summary,valid.selfCheck.concept_summary);assert.equal(result.data.wordCount,8000);
});
test("the short general form accepts a book enquiry without the book-page fields",()=>{
 const result=validate({...valid,service:"Book or manuscript assessment",projectStage:"",wordCount:null,selfCheck:null});
 assert.ok(result.data);assert.equal(result.data.wordCount,null);
});
test("rejects missing consent, invalid emails, excessive words and unexpected fields",()=>{
 for(const patch of [{consent:false},{email:"bad\r\nBcc: victim@example.invalid"},{description:"word ".repeat(301)},{unknown:"value"},{wordCount:-1},{selfCheck:{unsafe:{nested:true}}}])assert.ok(validate({...valid,...patch}).error);
});
test("rejects an invalid name, unsupported service, bad stage, malformed campaign and huge payload",()=>{
 for(const patch of [{name:"x\nHeader"},{service:"Send mail"},{projectStage:"unknown"},{campaigns:{unknown:"value"}},{description:"x".repeat(36000)}])assert.ok(validate({...valid,...patch}).error);
});
test("admin receives the complete brief; fixed acknowledgement does not echo arbitrary client text",()=>{
 const mail=messages(validate(valid).data,valid.requestId);assert.equal(mail.admin.to,"willemkempen@clearcopy.clinic");assert.match(mail.admin.text,/Included self-check answers/);assert.equal(mail.acknowledgement.text.includes(valid.description),false);
});
test("delivers the business message before acknowledging and returns a true receipt",async()=>{
 const s=setup(),res=await s.invoke();assert.equal(res.statusCode,200);assert.equal(res.body.received,true);assert.equal(res.body.acknowledgementSent,true);assert.equal(s.sent.length,2);assert.equal(res.headers["Cache-Control"],"no-store");
 assert.equal(JSON.stringify(s.stored).includes(valid.email),false);assert.equal(JSON.stringify(s.stored).includes(valid.description),false);
 assert.equal(JSON.stringify(s.logs).includes(valid.email),false);
});
test("SMTP failure never claims receipt and sends no acknowledgement",async()=>{
 const s=setup({adminFails:true}),res=await s.invoke();assert.equal(res.statusCode,502);assert.equal(res.body.received,undefined);assert.equal(s.sent.length,1);assert.equal(JSON.stringify(res.body).includes("private-email-error"),false);
});
test("acknowledgement failure preserves an already accepted enquiry",async()=>{
 const s=setup({ackFails:true}),res=await s.invoke();assert.equal(res.statusCode,200);assert.equal(res.body.received,true);assert.equal(res.body.acknowledgementSent,false);
});
test("duplicates and quota limits do not resend mail",async()=>{
 for(const [kind,status] of [["received",200],["limited",429],["busy",409],["conflict",409]]){
  const s=setup({kind}),res=await s.invoke();assert.equal(res.statusCode,status);assert.equal(s.sent.length,0);
 }
});
test("rejects unsupported origins, methods and content types before sending",async()=>{
 const s=setup();for(const [options,status] of [[{origin:"https://other.invalid"},403],[{method:"GET"},405],[{json:false},415]])assert.equal((await s.invoke(options)).statusCode,status);assert.equal(s.sent.length,0);
});
test("missing configuration gives an honest unavailable response",async()=>{
 const s=setup({config:false}),res=await s.invoke();assert.equal(res.statusCode,503);assert.equal(s.sent.length,0);assert.equal(s.reserveCalls,0);
});
function fakeDatabase(){
 const docs=new Map();let queue=Promise.resolve();
 const ref=path=>({path,async update(value){docs.set(path,{...docs.get(path),...value});}});
 return {docs,collection:name=>({doc:id=>ref(name+"/"+id)}),runTransaction(fn){
  const run=queue.then(()=>fn({async getAll(...refs){return refs.map(r=>({exists:docs.has(r.path),data:()=>{const data=docs.get(r.path);return {...data,startedAt:data.startedAt?{toDate:()=>data.startedAt}:undefined};}}));},set(r,v){docs.set(r.path,v);}}));
  queue=run.catch(()=>{});return run;
 }};
}
test("durable reservation admits only one concurrent request for the same reference",async()=>{
 const db=fakeDatabase(),s=createStore({db,now:()=>new Date("2026-11-26T10:00:00Z")});
 const data={id:valid.requestId,payloadHash:"payload",ipHash:"ip",emailHash:"email",challengeHash:"challenge"};
 const result=await Promise.all([s.reserve(data),s.reserve(data)]);
 assert.deepEqual(result.map(x=>x.kind),["new","busy"]);await s.finish(data.id,true);
 assert.equal((await s.reserve(data)).kind,"received");assert.equal((await s.reserve({...data,payloadHash:"changed"})).kind,"conflict");
});
test("quota state survives creating a new handler/store over the same database",async()=>{
 const db=fakeDatabase(),now=()=>new Date("2026-11-26T10:00:00Z"),a=createStore({db,now});
 for(let n=0;n<3;n++)assert.equal((await a.reserve({id:"reference-"+n,payloadHash:"p",ipHash:"ip",emailHash:"same-email",challengeHash:"challenge-"+n})).kind,"new");
 const b=createStore({db,now});assert.equal((await b.reserve({id:"reference-4",payloadHash:"p",ipHash:"ip",emailHash:"same-email",challengeHash:"challenge-4"})).kind,"limited");
});
test("unverified junk cannot consume delivery quotas or trigger either email",async()=>{
 const s=setup({challenge:"rejected"});
 for(let n=0;n<35;n++)assert.equal((await s.invoke()).statusCode,403);
 assert.equal(s.reserveCalls,0);assert.equal(s.sent.length,0);
});
test("missing, blank and oversized tokens are rejected before verification or quota access",async()=>{
 for(const turnstileToken of [undefined,"","x".repeat(2049)]){
  const s=setup(),res=await s.invoke({body:{...valid,turnstileToken}});
  assert.equal(res.statusCode,400);assert.equal(s.verified.length,0);assert.equal(s.reserveCalls,0);assert.equal(s.sent.length,0);
 }
});
test("verification outages and exceptions fail closed without sending or reserving",async()=>{
 for(const options of [{challenge:"unavailable"},{verificationThrows:true}]){
  const s=setup(options),res=await s.invoke();assert.equal(res.statusCode,503);assert.equal(s.reserveCalls,0);assert.equal(s.sent.length,0);
 }
});
test("both exact HTTPS origins pass CORS and use the corresponding challenge hostname",async()=>{
 for(const hostname of ["clearcopy.clinic","www.clearcopy.clinic"]){
  const s=setup(),origin="https://"+hostname,res=await s.invoke({origin});
  assert.equal(res.statusCode,200);assert.equal(res.headers["Access-Control-Allow-Origin"],origin);assert.equal(s.verified[0].hostname,hostname);
  assert.equal(s.verified[0].reference,valid.requestId);assert.equal(s.verified[0].token,valid.turnstileToken);
 }
 for(const origin of ["http://www.clearcopy.clinic","https://www.clearcopy.clinic.attacker.invalid","https://preview.clearcopy.clinic"]){
  const s=setup();assert.equal((await s.invoke({origin})).statusCode,403);assert.equal(s.sent.length,0);
 }
});
test("WWW preflight works without challenge validation or quota use",async()=>{
 const s=setup(),res=await s.invoke({origin:"https://www.clearcopy.clinic",method:"OPTIONS"});
 assert.equal(res.statusCode,204);assert.equal(res.headers["Access-Control-Allow-Origin"],"https://www.clearcopy.clinic");assert.equal(s.verified.length,0);assert.equal(s.reserveCalls,0);
});
test("an already used challenge cannot reserve another reference or spend more quota",async()=>{
 const db=fakeDatabase(),s=createStore({db,now:()=>new Date("2026-11-26T10:00:00Z")});
 const data={id:"one",payloadHash:"p",ipHash:"ip",emailHash:"email",challengeHash:"same-token"};
 const result=await Promise.all([s.reserve(data),s.reserve({...data,id:"two"})]);
 assert.deepEqual(result.map(x=>x.kind),["new","replayed"]);assert.equal(db.docs.get("cccEnquiryLimits/global-2026-11-26").count,1);
 assert.equal(JSON.stringify([...db.docs]).includes("test-token"),false);
});
test("a failed SMTP attempt can retry with a fresh challenge but cannot replay the old one",async()=>{
 const db=fakeDatabase(),s=createStore({db,now:()=>new Date("2026-11-26T10:00:00Z")});
 const data={id:"retry",payloadHash:"p",ipHash:"ip",emailHash:"email",challengeHash:"first"};
 assert.equal((await s.reserve(data)).kind,"new");await s.fail(data.id);
 assert.equal((await s.reserve(data)).kind,"replayed");assert.equal((await s.reserve({...data,challengeHash:"fresh"})).kind,"new");
});
