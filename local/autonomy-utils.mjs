import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export function saveJson(file,data) {fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(data,null,2));fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
export function localTime(ts,timezone='Asia/Shanghai') {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ts)).map(p=>[p.type,p.value]));
  const day=parts.year+'-'+parts.month+'-'+parts.day,weekday=(new Date(day+'T12:00:00Z').getUTCDay()+6)%7;
  const monday=new Date(Date.parse(day+'T12:00:00Z')-weekday*86400000).toISOString().slice(0,10);
  return {day,week:monday,minute:Number(parts.hour)*60+Number(parts.minute),weekday,weekdayName:'星期'+['一','二','三','四','五','六','日'][weekday]};
}
export function minute(value) {if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value||''))throw new Error('自主行为时间格式无效');return Number(value.slice(0,2))*60+Number(value.slice(3));}
export function windowOpen(local,options) {const a=minute(options.activeStart),b=minute(options.activeEnd);if(a>=b)throw new Error('主动窗口需在同一天内，起始早于结束');return local.minute>=a&&local.minute<b;}
export function similar(a,b) {const norm=x=>String(x).toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');const x=norm(a),y=norm(b);if(x===y||x.includes(y)&&y.length>10||y.includes(x)&&x.length>10)return true;const grams=s=>new Set(Array.from(s).slice(1).map((_,i)=>s.slice(i,i+2)));const A=grams(x),B=grams(y);const both=[...A].filter(v=>B.has(v)).length;return both/Math.max(1,A.size+B.size-both)>0.62;}
export function validPublicText(text,forbidden=[]) {return typeof text==='string'&&text.trim().length>=3&&text.length<=300&&!/(?:https?:|www\.|sk-[a-z\d_-]+|Bearer\s|api.?key|access.?token|\b\d{5,}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|私聊截图|聊天记录|手机号|身份证)/i.test(text)&&!forbidden.some(v=>v&&text.includes(String(v)));}
export function validContextFacts(text,local) {
  if(/(?:今天|现在|外面|刚刚|最近).{0,8}(?:降温|下雨|下雪|晴天|升温|刮风)|天气.{0,4}(?:凉|冷|暖|热)|我(?:刚刚|今天|刚才).{0,8}(?:去了|吃了|买了|看到了|散步)/.test(text))return false;
  const weekdays=[...text.matchAll(/(?:今天(?:是)?|现在(?:是)?).{0,2}(?:周|星期)([一二三四五六日天])/g)].map(m=>m[1]==='天'?'日':m[1]);
  return weekdays.every(day=>day===local.weekdayName.slice(-1));
}
