(function(){
"use strict";
const EMAIL="willemkempen@clearcopy.clinic",form=document.querySelector("[data-enquiry-form]");
if(!form)return;
const status=form.querySelector("[data-form-status]"),button=form.querySelector("[type=submit]");
const params=new URLSearchParams(location.search),campaigns={};
let requestId=newId(),selfCheck=null;
function newId(){return crypto.randomUUID();}
["utm_source","utm_medium","utm_campaign"].forEach(key=>{const value=(params.get(key)||"").trim().slice(0,100);if(value)campaigns[key]=value;});
document.querySelectorAll('a[href^="/"]').forEach(a=>{
 const u=new URL(a.getAttribute("href"),"https://clearcopy.clinic/");
 if(u.pathname==="/book.html"||u.pathname==="/")Object.entries(campaigns).forEach(([key,value])=>u.searchParams.set(key,value));
 a.setAttribute("href",u.pathname+u.search+u.hash);
});
function show(text,isError){
 status.replaceChildren();const p=document.createElement("p");p.textContent=text;status.append(p);
 const a=document.createElement("a");a.href="mailto:"+EMAIL;a.textContent=EMAIL;status.append(a);
 status.hidden=false;status.classList.toggle("error",Boolean(isError));status.focus();
}
function removeSelfCheck(){selfCheck=null;requestId=newId();form.querySelector("[data-selfcheck-summary]")?.remove();}
form.addEventListener("input",()=>{requestId=newId();});
document.addEventListener("ccc:book-selfcheck",event=>{
 if(!form.elements.projectStage||!event.detail)return;
 const detail=event.detail;selfCheck=JSON.parse(JSON.stringify(detail.answers));requestId=newId();
 const fill=(name,value)=>{const field=form.elements.namedItem(name);if(field&&!field.value&&value)field.value=value;};
 fill("projectStage",detail.projectStage);fill("description",detail.answers.concept_summary);
 fill("bookType",detail.answers.publication_type);
 fill("language",["English","Afrikaans"].includes(detail.answers.publication_language)?detail.answers.publication_language:"Other");
 if(detail.projectStage==="Idea only")fill("wordCount","0");
 form.querySelector("[data-selfcheck-summary]")?.remove();
 const summary=document.createElement("details");summary.dataset.selfcheckSummary="";summary.className="selfcheck-summary";
 const title=document.createElement("summary");title.textContent="Self-check answers included with this enquiry — review or remove";summary.append(title);
 const note=document.createElement("p");note.textContent="Your answers will be sent only if you submit the enquiry. Please review the prefilled fields and add an approximate word count.";summary.append(note);
 const list=document.createElement("dl");
 Object.entries(selfCheck).forEach(([key,value])=>{
  const label=document.createElement("dt"),answer=document.createElement("dd");label.textContent=key.replaceAll("_"," ");
  answer.textContent=Array.isArray(value)?value.join("; "):String(value);list.append(label,answer);
 });summary.append(list);
 const remove=document.createElement("button");remove.type="button";remove.className="button secondary";remove.textContent="Remove self-check answers";
 remove.addEventListener("click",removeSelfCheck);summary.append(remove);
 form.querySelector("[type=submit]").before(summary);
});
form.addEventListener("submit",async event=>{
 event.preventDefault();if(!form.reportValidity())return;
 const data=new FormData(form),description=String(data.get("description")||"").trim();
 if(description.length<10||description.split(/\s+/).filter(Boolean).length>300){show("Please describe the project in at least 10 characters and no more than 300 words.",true);return;}
 if(data.get("website"))return;
 const endpoint=String(form.dataset.endpoint||"").trim();
 if(!endpoint){show("This is a review version. Your details have not been sent. You can email Willem directly at:",false);return;}
 const payload={requestId,
 name:String(data.get("name")||"").trim(),email:String(data.get("email")||"").trim(),
 service:String(data.get("service")||"Book suitability check"),description,
 projectStage:String(data.get("projectStage")||""),wordCount:data.has("wordCount")?Number(data.get("wordCount")):null,
 language:String(data.get("language")||""),bookType:String(data.get("bookType")||""),
 deadline:String(data.get("deadline")||""),source:String(data.get("source")||""),
 consent:data.get("consent")==="yes",campaigns,selfCheck};
 if(!/^https:\/\//.test(endpoint)){show("Online delivery is unavailable. Please send your enquiry directly to:",true);return;}
 button.disabled=true;button.textContent="Checking…";
 let timeout;
 try{
  try{
   if(typeof window.cccSpamCheck!=="function")throw new Error("spam-check-unavailable");
   payload.turnstileToken=await window.cccSpamCheck(form,payload.requestId);
  }catch{show("The spam check could not be completed. Please try again or email Willem directly at:",true);return;}
  if(requestId!==payload.requestId){show("Your enquiry changed during the spam check. Please select Send enquiry again to send the updated details.",true);return;}
  button.textContent="Sending enquiry…";
  const controller=new AbortController();timeout=setTimeout(()=>controller.abort(),45000);
  const response=await fetch(endpoint,{method:"POST",credentials:"omit",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),signal:controller.signal});
  const result=await response.json().catch(()=>({}));
  if(!response.ok||result.received!==true)throw new Error("delivery-unconfirmed");
  const ack=result.acknowledgementSent===false?" The email acknowledgement could not be sent; the enquiry itself was accepted.":"";
  show("Your enquiry has been received. Willem will give you a first personal reply within one working day."+ack,false);
  form.reset();removeSelfCheck();requestId=newId();
 }catch{show("We could not confirm that your enquiry arrived. Please email Willem directly at:",true);}
 finally{clearTimeout(timeout);button.disabled=false;button.textContent="Send enquiry";}
});
})();
