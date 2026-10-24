import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const auditDirectory=()=>process.env.COMPANION_AUDIT_DIR?path.resolve(process.env.COMPANION_AUDIT_DIR):path.join(root,'logs/native-vision');
export function auditRequest(body,endpoint) {
  const id=randomUUID();let imageCount=0;
  const copy={...body,messages:body.messages.map(message=>({role:message.role,...(message.tool_call_id?{tool_call_id:'[redacted]'}:{}),
    content:Array.isArray(message.content)?message.content.map(part=>{
      if(part.type!=='image_url') return {type:part.type,text:'[TEXT REDACTED]'};
      imageCount++;
      const match=/^data:([^;]+);base64,(.+)$/s.exec(part.image_url?.url||'');
      const bytes=match?Buffer.from(match[2],'base64'):null;
      return {type:'image_url',image_url:{url:match?`data:${match[1]};base64,[REDACTED ${bytes.length} bytes]`:'[REMOTE URL REDACTED]'},...(bytes?{sha256:createHash('sha256').update(bytes).digest('hex')}: {})};
    }):'[TEXT REDACTED]',...(message.tool_calls?{tool_calls:message.tool_calls.map(call=>({type:'function',function:{name:call.function?.name,arguments:'[REDACTED]'}}))}:{})})),
    ...(body.tools?{tools:body.tools.map(tool=>({type:'function',function:{name:tool.function.name}}))}:{})};
  const dir=auditDirectory();fs.mkdirSync(dir,{recursive:true});
  if(imageCount) fs.writeFileSync(path.join(dir,'latest-request.redacted.json'),JSON.stringify({auditId:id,method:'POST',endpoint,headers:{Authorization:'Bearer [REDACTED]','Content-Type':'application/json'},imageCount,body:copy},null,2));
  return {id,imageCount};
}
export function auditResponse(request,result,status) {
  const dir=auditDirectory();fs.mkdirSync(dir,{recursive:true});
  fs.appendFileSync(path.join(dir,'requests.jsonl'),JSON.stringify({at:new Date().toISOString(),...request,status,requestId:result.id,model:result.model,usage:result.usage})+'\n');
}
