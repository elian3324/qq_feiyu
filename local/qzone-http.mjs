export const cookieToString = cookies => Object.entries(cookies).map(([k,v])=>k+'='+v).join('; ');
export function getBknFromCookie(cookies) {
  let hash=5381;
  for(const char of (cookies.p_skey || cookies.skey || '')) hash += (hash << 5) + char.charCodeAt(0);
  return String(hash & 2147483647);
}
export const RequestUtil={
  async HttpGetText(address,method='GET',data='',headers={}) {
    const url=new URL(address);
    if(url.protocol!=='https:' || !['h5.qzone.qq.com','user.qzone.qq.com','up.qzone.qq.com'].includes(url.hostname)) throw new Error('Qzone request destination is not allowed');
    const response=await fetch(url,{
      method,redirect:'error',headers:{
        'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
        Referer:'https://user.qzone.qq.com/',...headers,
      },...(method==='GET'?{}:{body:data}),signal:AbortSignal.timeout(20000),
    });
    if(!response.ok) throw new Error('Qzone returned HTTP '+response.status);
    const size=Number(response.headers.get('content-length')||0);
    if(size>8*1024*1024) throw new Error('Qzone response too large');
    const text=await response.text();
    if(text.length>8*1024*1024) throw new Error('Qzone response too large');
    // An empty, authenticated space can use null instead of an empty array.
    if(url.pathname.endsWith('emotion_cgi_msglist_v6')) {
      try {
        const json=JSON.parse(text.slice(text.indexOf('{'),text.lastIndexOf('}')+1));
        if(json.code===0 && json.total===0 && json.msglist===null) { json.msglist=[];return JSON.stringify(json); }
      } catch {}
    }
    return text;
  },
};
