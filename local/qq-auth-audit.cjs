const fs = require('node:fs');
const allowed = new Set(['code','result','ret','retCode','errCode','errorCode','errType','error_type','status']);
function safeResult(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 1) return {};
  const result = {};
  for (const key of allowed) {
    const v = value[key];
    if (Number.isInteger(v) && v >= -2147483648 && v <= 2147483647) result[key] = v;
    else if (typeof v === 'string' && /^-?\d{1,10}$/.test(v) && Number(v) >= -2147483648 && Number(v) <= 2147483647) result[key] = Number(v);
    else if (v && typeof v === 'object') {const child = safeResult(v, depth + 1);if (Object.keys(child).length) result[key] = child;}
  }
  return result;
}
function record(event, args) {
  const file = process.env.COMPANION_AUTH_AUDIT_FILE;
  if (!file) return;
  const result = safeResult(args[0]);
  if (event === 'msf-error' && Number.isInteger(args[0]) && args[0] >= -2147483648 && args[0] <= 2147483647) result.code = args[0];
  try {fs.appendFileSync(file, JSON.stringify({at:new Date().toISOString(),event,...result})+'\n');}catch{}
}
function attachAuthAudit(listener, eventName, event, emit = record) {
  if (!listener || typeof listener !== 'object') return;
  const original = listener[eventName];
  try {listener[eventName] = function(...args) {
    try {emit(event,args);}catch{}
    if (typeof original === 'function') return Reflect.apply(original,this,args);
  };}catch{}
}
function lifecycle(event,error) {
  const file=process.env.COMPANION_AUTH_AUDIT_FILE;
  if(!file)return;
  const code=typeof error?.code==='string'&&/^[A-Z_]{3,50}$/.test(error.code)?error.code:undefined;
  const errorType=['Error','TypeError','ReferenceError','SyntaxError','RangeError'].includes(error?.name)?error.name:undefined;
  try{fs.appendFileSync(file,JSON.stringify({at:new Date().toISOString(),event,code,errorType})+'\n');}catch{}
}
module.exports = {safeResult,attachAuthAudit,lifecycle};
