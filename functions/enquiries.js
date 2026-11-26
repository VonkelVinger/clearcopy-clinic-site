"use strict";
const { defineSecret,defineString }=require("firebase-functions/params");
const { onRequest }=require("firebase-functions/v2/https");
const logger=require("firebase-functions/logger");
const nodemailer=require("nodemailer");
const { getApps,initializeApp }=require("firebase-admin/app");
const { getFirestore }=require("firebase-admin/firestore");
const { createHandler }=require("./enquiry-handler");
const { createStore }=require("./enquiry-store");
const { createVerifier }=require("./enquiry-turnstile");
const USER=defineSecret("CCC_SMTP_USERNAME");
const PASSWORD=defineSecret("CCC_SMTP_PASSWORD");
const PEPPER=defineSecret("CCC_ENQUIRY_PEPPER");
const TURNSTILE=defineSecret("CCC_TURNSTILE_SECRET_KEY");
const HOST=defineString("CCC_SMTP_HOST");
const PORT=defineString("CCC_SMTP_PORT",{default:"465"});
let store;
function currentStore(){
 if(!store){if(!getApps().length)initializeApp();store=createStore({db:getFirestore()});}
 return store;
}
const handler=createHandler({
 getConfig:()=>({host:HOST.value(),port:Number(PORT.value()),user:USER.value(),password:PASSWORD.value(),pepper:PEPPER.value(),turnstileSecret:TURNSTILE.value()}),
 verifyChallenge:createVerifier(),
 store:{reserve:data=>currentStore().reserve(data),finish:(id,ack)=>currentStore().finish(id,ack),fail:id=>currentStore().fail(id)},
 async sendMail(message,config){
  if(![465,587].includes(config.port))throw new Error("unsupported-smtp-port");
  const transport=nodemailer.createTransport({
   host:config.host,port:config.port,secure:config.port===465,requireTLS:config.port===587,
   auth:{user:config.user,pass:config.password},
   tls:{minVersion:"TLSv1.2",rejectUnauthorized:true},
   connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,
   logger:false,debug:false
  });
  try{
   const result=await transport.sendMail(message);
   const recipient=typeof message.to==="string"?message.to:message.to.address;
   if(!result.accepted||!result.accepted.some(value=>String(value).toLowerCase()===recipient.toLowerCase()))throw new Error("recipient-not-accepted");
  }finally{transport.close();}
 },
 log:logger
});
exports.submitEnquiry=onRequest({cors:false,region:"us-central1",maxInstances:1,concurrency:5,timeoutSeconds:60,secrets:[USER,PASSWORD,PEPPER,TURNSTILE]},handler);
