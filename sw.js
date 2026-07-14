const CACHE='novel-studio-v39-auto-update';
const CORE=['./','./index.html','./styles.css?v=39','./app.js?v=39','./manifest.webmanifest','./icon-192.png','./icon-512.png','./mammoth.browser.min.js','./pdf.legacy.min.mjs','./pdf.legacy.worker.min.mjs'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting()});
async function networkFirst(request){
  try{const response=await fetch(request,{cache:'no-store'});if(response&&response.ok){const cache=await caches.open(CACHE);cache.put(request,response.clone())}return response}catch(_){return (await caches.match(request))||(request.mode==='navigate'?await caches.match('./index.html'):Response.error())}
}
async function cacheFirst(request){const cached=await caches.match(request);if(cached)return cached;const response=await fetch(request);if(response&&response.ok){const cache=await caches.open(CACHE);cache.put(request,response.clone())}return response}
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  const path=url.pathname;
  const dynamic=event.request.mode==='navigate'||/\/(?:index\.html|app\.js|styles\.css|sw\.js|version\.json)$/.test(path);
  event.respondWith(dynamic?networkFirst(event.request):cacheFirst(event.request));
});
