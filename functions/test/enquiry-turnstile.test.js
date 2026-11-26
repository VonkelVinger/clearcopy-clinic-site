"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createVerifier}=require("../enquiry-turnstile");
const input={token:"opaque-widget-token",secret:"server-only-secret",hostname:"clearcopy.clinic",reference:"52c95f34-bab2-4168-bb7d-8a772f136349"};
const success={success:true,hostname:input.hostname,action:"ccc-enquiry",cdata:input.reference};
test("server verifies at the fixed Cloudflare URL with only the secret and token",async()=>{
 const calls=[],verify=createVerifier({fetchImpl:async(...args)=>{calls.push(args);return {ok:true,json:async()=>success};}});
 assert.deepEqual(await verify(input),{kind:"verified"});
 const [url,options]=calls[0];assert.equal(url,"https://challenges.cloudflare.com/turnstile/v0/siteverify");assert.equal(options.method,"POST");
 assert.deepEqual(Object.fromEntries(options.body),{secret:input.secret,response:input.token});assert.equal(calls.length,1);
});
test("hostname, action and request-reference mismatches are all rejected",async()=>{
 for(const patch of [{hostname:"www.clearcopy.clinic"},{hostname:"clearcopy.clinic.attacker.invalid"},{action:"other-form"},{cdata:"other-reference"},{cdata:undefined}]){
  const verify=createVerifier({fetchImpl:async()=>({ok:true,json:async()=>({...success,...patch})})});assert.equal((await verify(input)).kind,"rejected");
 }
});
test("expired, forged and already spent challenge responses are rejected",async()=>{
 for(const code of ["timeout-or-duplicate","invalid-input-response","missing-input-response"]){
  const verify=createVerifier({fetchImpl:async()=>({ok:true,json:async()=>({success:false,"error-codes":[code]})})});assert.equal((await verify(input)).kind,"rejected");
 }
});
test("provider failures, malformed data and secret errors fail closed",async()=>{
 const fixtures=[{ok:false},{ok:true,json:async()=>null},{ok:true,json:async()=>({success:"true"})},{ok:true,json:async()=>{throw new Error("private-response");}},
  ...["internal-error","invalid-input-secret","missing-input-secret"].map(code=>({ok:true,json:async()=>({success:false,"error-codes":[code]})}))];
 for(const fixture of fixtures){const verify=createVerifier({fetchImpl:async()=>fixture});assert.equal((await verify(input)).kind,"unavailable");}
});
test("verification requests have a bounded timeout",async()=>{
 const verify=createVerifier({timeoutMs:5,fetchImpl:async(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener("abort",()=>reject(new Error("aborted")),{once:true}))});
 assert.equal((await verify(input)).kind,"unavailable");
});
test("dummy production secrets and invalid tokens never reach Siteverify",async()=>{
 let calls=0;const verify=createVerifier({fetchImpl:async()=>{calls++;throw new Error("must-not-run");}});
 for(const secret of ["","1x0000000000000000000000000000000AA","2x0000000000000000000000000000000AA","3x0000000000000000000000000000000AA"])assert.equal((await verify({...input,secret})).kind,"unavailable");
 for(const token of ["",null,"x".repeat(2049)])assert.equal((await verify({...input,token})).kind,"rejected");
 assert.equal(calls,0);
});
