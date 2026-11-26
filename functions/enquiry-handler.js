"use strict";
const { createHmac } = require("node:crypto");
const { validate,messages } = require("./enquiry-input");
const ORIGINS=new Set(["https://clearcopy.clinic","https://www.clearcopy.clinic","http://localhost:8080","http://127.0.0.1:8080"]);
function createHandler({getConfig,verifyChallenge,store,sendMail,log={info(){},error(){}}}){
 return async function(request,response){
  const origin=request.get("origin");
  response.set("Cache-Control","no-store");
  if(!ORIGINS.has(origin))return response.status(403).json({error:"Origin not allowed."});
  response.set("Access-Control-Allow-Origin",origin);
  response.set("Vary","Origin");
  response.set("Access-Control-Allow-Methods","POST, OPTIONS");
  response.set("Access-Control-Allow-Headers","Content-Type");
  if(request.method==="OPTIONS")return response.status(204).send("");
  if(request.method!=="POST")return response.status(405).json({error:"Use POST."});
  if(!request.is("application/json"))return response.status(415).json({error:"Send JSON."});
  const parsed=validate(request.body);
  if(parsed.error)return response.status(400).json({error:parsed.error});
  const data=parsed.data,reference=data.requestId;
  let config;
  try{config=getConfig();}catch{return response.status(503).json({error:"Online enquiries are temporarily unavailable."});}
  if(!config||!config.pepper||!config.host||!config.user||!config.password||!config.turnstileSecret||typeof verifyChallenge!=="function")return response.status(503).json({error:"Online enquiries are temporarily unavailable."});
  let challenge;
  try{challenge=await verifyChallenge({token:parsed.turnstileToken,secret:config.turnstileSecret,hostname:new URL(origin).hostname,reference});}
  catch{return response.status(503).json({error:"The spam check is temporarily unavailable. Please email Willem directly."});}
  if(challenge?.kind!=="verified")return response.status(challenge?.kind==="rejected"?403:503).json({error:"The spam check could not be confirmed. Please try again or email Willem directly."});
  const digest=value=>createHmac("sha256",config.pepper).update(value).digest("hex");
  let reservation;
  try{reservation=await store.reserve({id:reference,payloadHash:digest(JSON.stringify(data)),ipHash:digest(String(request.ip||"unknown")),emailHash:digest(data.email.toLowerCase()),challengeHash:digest(parsed.turnstileToken)});}
  catch{log.error({event:"enquiry_store_unavailable",reference});return response.status(503).json({error:"Online enquiries are temporarily unavailable."});}
  if(reservation.kind==="received")return response.status(200).json({received:true,reference,acknowledgementSent:Boolean(reservation.acknowledgementSent),duplicate:true});
  if(reservation.kind==="limited")return response.status(429).json({error:"The enquiry limit has been reached. Please email Willem directly."});
  if(reservation.kind==="replayed")return response.status(403).json({error:"The spam check has already been used. Please try again."});
  if(reservation.kind!=="new")return response.status(409).json({error:"This reference is already being handled. Please wait or email Willem directly."});
  const mail=messages(data,reference);
  try{await sendMail(mail.admin,config);}
  catch{await store.fail(reference).catch(()=>{});log.error({event:"enquiry_delivery_failed",reference});return response.status(502).json({error:"Delivery could not be confirmed. Please email Willem directly."});}
  // Persist the accepted admin message before sending the optional acknowledgement.
  try{await store.finish(reference,false);}
  catch{log.error({event:"enquiry_receipt_record_failed",reference});return response.status(503).json({error:"Delivery status could not be confirmed. Please email Willem with this reference.",reference});}
  let acknowledgementSent=false;
  try{await sendMail(mail.acknowledgement,config);acknowledgementSent=true;await store.finish(reference,true);}
  catch{log.error({event:"enquiry_acknowledgement_failed",reference});}
  log.info({event:"enquiry_received",reference,acknowledgementSent});
  return response.status(200).json({received:true,reference,acknowledgementSent});
 };
}
module.exports={createHandler};
