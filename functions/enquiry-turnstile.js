"use strict";
const SITEVERIFY="https://challenges.cloudflare.com/turnstile/v0/siteverify";
const ACTION="ccc-enquiry";
const TEST_SECRETS=new Set(["1x0000000000000000000000000000000AA","2x0000000000000000000000000000000AA","3x0000000000000000000000000000000AA"]);
function createVerifier({fetchImpl=fetch,timeoutMs=8000}={}){
 return async function verify({token,secret,hostname,reference}){
  if(!secret||TEST_SECRETS.has(secret))return {kind:"unavailable"};
  if(typeof token!=="string"||!token||token.length>2048)return {kind:"rejected"};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   // Do not send project text, client email or a user-supplied verification URL.
   const response=await fetchImpl(SITEVERIFY,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({secret,response:token}),signal:controller.signal});
   if(!response.ok)return {kind:"unavailable"};
   const result=await response.json();
   if(!result||typeof result!=="object"||Array.isArray(result)||typeof result.success!=="boolean")return {kind:"unavailable"};
   if(result.success!==true){
    const codes=result["error-codes"];
    return {kind:Array.isArray(codes)&&codes.some(code=>["internal-error","invalid-input-secret","missing-input-secret"].includes(code))?"unavailable":"rejected"};
   }
   return {kind:result.hostname===hostname&&result.action===ACTION&&result.cdata===reference?"verified":"rejected"};
  }catch{return {kind:"unavailable"};}
  finally{clearTimeout(timer);}
 };
}
module.exports={createVerifier,ACTION};
