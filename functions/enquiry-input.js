"use strict";
const { randomUUID } = require("node:crypto");
const EMAIL = "willemkempen@clearcopy.clinic";
const SERVICES = new Set(["Editing or proofreading","Translation","Book or manuscript assessment","Writing or editing coaching","Urgent editorial help","Regular editorial support","Something else","Book suitability check"]);
const STAGES = new Set(["Idea only","Notes or research","Partial manuscript","Complete manuscript","Previously submitted or rejected","Published, considering a new version"]);
const ANSWERS = new Set(["project_stage","publication_type","publication_language","concept_summary","audience_types","geographic_market","niche_level","author_authority","author_establishment","author_platform","material_volume","development_needs","development_openness","market_awareness","success_goal","previous_barriers","why_exists","fiction_appeal","genre_clarity","age_range","illustration_central"]);
const FIELDS = new Set(["requestId","name","email","service","description","projectStage","wordCount","language","bookType","deadline","source","consent","campaigns","selfCheck","website","turnstileToken"]);
function text(value,max=120){return typeof value==="string"&&value.length<=max?value.trim():null;}
function validate(body){
 if(!body||typeof body!=="object"||Array.isArray(body))return {error:"Send an enquiry object."};
 if(Buffer.byteLength(JSON.stringify(body),"utf8")>35000)return {error:"The enquiry is too long."};
 if(Object.keys(body).some(k=>!FIELDS.has(k)))return {error:"Unexpected enquiry field."};
 const turnstileToken=text(body.turnstileToken,2048);
 if(!turnstileToken)return {error:"Complete the spam check before sending."};
 const name=text(body.name),email=text(body.email,254),description=text(body.description,3000);
 if(!name||name.length<2||/[\r\n]/.test(name))return {error:"Enter your name."};
 if(!email||/[\r\n]/.test(email)||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))return {error:"Enter a valid email address."};
 if(!SERVICES.has(body.service))return {error:"Choose a service."};
 if(!description||description.length<10||description.split(/\s+/).length>300)return {error:"Describe the project in 10 characters to 300 words."};
 if(body.consent!==true)return {error:"Consent to being contacted is required."};
 if(body.website)return {error:"This enquiry could not be accepted."};
 const requestId=body.requestId||randomUUID();
 if(typeof requestId!=="string"||!/^[A-Za-z0-9-]{16,80}$/.test(requestId))return {error:"Invalid enquiry reference."};
 const projectStage=text(body.projectStage||"",100);
 if(projectStage===null)return {error:"Invalid project stage."};
 const book=body.service==="Book suitability check"||body.service==="Book or manuscript assessment";
 const wordCount=body.wordCount===null||body.wordCount===undefined?null:body.wordCount;
 if(body.service==="Book suitability check"&&(!STAGES.has(projectStage)||!Number.isInteger(wordCount)||wordCount<0||wordCount>5000000))return {error:"Add the book stage and approximate word count."};
 if(wordCount!==null&&(!Number.isInteger(wordCount)||wordCount<0||wordCount>5000000))return {error:"Invalid word count."};
 const data={requestId,name,email,service:body.service,description,projectStage,wordCount,consent:true};
 for(const key of ["language","bookType","deadline","source"]){const value=text(body[key]||"",150);if(value===null||/[\r\n]/.test(value))return {error:"An optional field is invalid."};data[key]=value;}
 data.campaigns={};
 if(body.campaigns!==undefined){
  if(!body.campaigns||typeof body.campaigns!=="object"||Array.isArray(body.campaigns))return {error:"Invalid campaign details."};
  for(const key of Object.keys(body.campaigns).sort()){if(!["utm_source","utm_medium","utm_campaign"].includes(key))return {error:"Unexpected campaign field."};const value=text(body.campaigns[key],100);if(value===null)return {error:"Invalid campaign details."};data.campaigns[key]=value;}
 }
 data.selfCheck=null;
 if(body.selfCheck!==undefined&&body.selfCheck!==null){
  if(!book||typeof body.selfCheck!=="object"||Array.isArray(body.selfCheck))return {error:"Invalid self-check answers."};
  data.selfCheck={};
  for(const key of Object.keys(body.selfCheck).sort()){
   if(!ANSWERS.has(key))return {error:"Unexpected self-check field."};
   const value=body.selfCheck[key];
   if(typeof value==="string"&&value.length<=1200)data.selfCheck[key]=value;
   else if(key==="niche_level"&&Number.isInteger(value)&&value>=1&&value<=5)data.selfCheck[key]=value;
   else if(Array.isArray(value)&&value.length<=30&&value.every(v=>typeof v==="string"&&v.length<=300))data.selfCheck[key]=value;
   else return {error:"A self-check answer is invalid."};
  }
 }
 return {data,turnstileToken};
}
function messages(data,reference){
 const lines=["Reference: "+reference,"Name: "+data.name,"Email: "+data.email,"Service: "+data.service];
 for(const key of ["projectStage","wordCount","language","bookType","deadline","source"]){if(data[key]!==null&&data[key]!=="")lines.push(key+": "+data[key]);}
 lines.push("","Project description:",data.description,"","Campaign: "+JSON.stringify(data.campaigns));
 if(data.selfCheck)lines.push("","Included self-check answers:",JSON.stringify(data.selfCheck,null,2));
 return {
  admin:{from:{name:"Clear Copy Clinic",address:EMAIL},to:EMAIL,replyTo:{name:data.name,address:data.email},subject:"CCC enquiry ["+reference+"]",text:lines.join("\n")},
  acknowledgement:{from:{name:"Willem Kempen | Clear Copy Clinic",address:EMAIL},to:data.email,replyTo:EMAIL,subject:"Your Clear Copy Clinic enquiry ["+reference+"]",text:"Your enquiry has been received.\n\nI will give you a first personal reply within one working day.\n\nReference: "+reference+"\nThis acknowledgement does not create a paid booking.\n\nWillem Kempen\n"+EMAIL,headers:{"Auto-Submitted":"auto-replied","X-Auto-Response-Suppress":"All"}}
 };
}
module.exports={validate,messages,EMAIL};
