"use strict";
const LIMITS={global:30,ip:5,email:3};
function createStore({db,now=()=>new Date()}){
 const receipts=db.collection("cccEnquiryReceipts"),limits=db.collection("cccEnquiryLimits"),challenges=db.collection("cccEnquiryChallenges");
 return {
  async reserve({id,payloadHash,ipHash,emailHash,challengeHash}){
   const date=now(),day=date.toISOString().slice(0,10),expiresAt=new Date(date.getTime()+48*60*60*1000);
   const receipt=receipts.doc(id),challenge=challenges.doc(challengeHash);
   const refs=[limits.doc("global-"+day),limits.doc("ip-"+day+"-"+ipHash),limits.doc("email-"+day+"-"+emailHash)];
   return db.runTransaction(async transaction=>{
    const [record,usedChallenge,...buckets]=await transaction.getAll(receipt,challenge,...refs);
    if(record.exists){
     const value=record.data();
     if(value.payloadHash!==payloadHash)return {kind:"conflict"};
     if(value.status==="received")return {kind:"received",acknowledgementSent:value.acknowledgementSent};
     if(value.status==="processing"&&value.startedAt.toDate().getTime()>date.getTime()-120000)return {kind:"busy"};
    }
    // Turnstile redemption can converge slowly; this transaction closes that gap.
    if(usedChallenge.exists)return {kind:"replayed"};
    const cap=[LIMITS.global,LIMITS.ip,LIMITS.email];
    if(buckets.some((snapshot,i)=>(snapshot.exists?snapshot.data().count:0)>=cap[i]))return {kind:"limited"};
    refs.forEach((ref,i)=>transaction.set(ref,{count:(buckets[i].exists?buckets[i].data().count:0)+1,expiresAt}));
    transaction.set(challenge,{expiresAt});
    transaction.set(receipt,{payloadHash,status:"processing",acknowledgementSent:false,startedAt:date,expiresAt});
    return {kind:"new"};
   });
  },
  async finish(id,acknowledgementSent){await receipts.doc(id).update({status:"received",acknowledgementSent,updatedAt:now()});},
  async fail(id){await receipts.doc(id).update({status:"failed",updatedAt:now()});}
 };
}
module.exports={createStore,LIMITS};
