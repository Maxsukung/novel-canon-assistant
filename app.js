
// V40: recover from stale mobile drawer state and preserve Android page scrolling.
(function initMobileScrollRecovery(){
  const unlock=()=>{
    document.documentElement.classList.remove('menu-open');
    document.body.classList.remove('menu-open');
    document.documentElement.style.removeProperty('overflow');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('position');
    document.body.style.removeProperty('top');
  };
  unlock();
  window.addEventListener('pageshow', unlock);
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) unlock(); });
})();
// Safari/iPad compatibility polyfills required by PDF.js 4.x
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}
if (typeof Promise.try !== 'function') {
  Promise.try = function (fn, ...args) {
    return new Promise(resolve => resolve(fn(...args)));
  };
}
if (typeof structuredClone !== 'function') {
  globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

let pdfjsLib=null;
async function getPdfJs(){
  if(!pdfjsLib){
    pdfjsLib=await import('./pdf.legacy.min.mjs?v=18');
    pdfjsLib.GlobalWorkerOptions.workerSrc='./pdf.legacy.worker.min.mjs';
  }
  return pdfjsLib;
}

const DB='NovelStudioDB', VER=1, STORE='state', KEY='app';
let state={version:1,projects:[],activeProjectId:null};
let currentChapterId=null, currentChapterSource='manual', currentCharacterId=null, currentNovelDocumentId=null, saveTimer=null, deferredPrompt=null, novelRenderToken=0, activePdfObjectUrl=null;
const $=q=>q.startsWith('#')||q.startsWith('.')||q.includes(' ')?document.querySelector(q):document.getElementById(q);
const uid=()=>crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`;
const now=()=>new Date().toISOString();
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open(DB,VER);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE)};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function getDB(){const db=await openDB();return new Promise((res,rej)=>{const r=db.transaction(STORE).objectStore(STORE).get(KEY);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function setDB(v){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(v,KEY);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)})}
function project(){return state.projects.find(p=>p.id===state.activeProjectId)||null}
function normalizeProject(p){return {id:p.id||uid(),name:p.name||'โปรเจกต์ไม่มีชื่อ',createdAt:p.createdAt||now(),updatedAt:p.updatedAt||now(),documents:p.documents||[],canon:p.canon||[],characters:p.characters||[],characterCandidates:p.characterCandidates||[],ignoredCharacterNames:p.ignoredCharacterNames||[],timeline:p.timeline||[],chapters:p.chapters||[],issues:p.issues||[],dna:p.dna||null,activity:p.activity||[]}}
async function save(message='บันทึกแล้ว'){const p=project();if(p)p.updatedAt=now();$('saveState').textContent='กำลังบันทึก…';await setDB(state);$('saveState').textContent=message;renderAll()}
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1800)}
function activity(type,text){const p=project();if(!p)return;p.activity.unshift({id:uid(),type,text,at:now()});p.activity=p.activity.slice(0,30)}

function switchView(id){window.scrollTo({top:0,left:0,behavior:'instant'});document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id));document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===id));const labels={dashboard:['ภาพรวม','จัดการนิยายและตรวจความต่อเนื่อง'],documents:['คลังเอกสาร','แยกดูเอกสารตามประเภทที่เลือก'],novelContent:['เนื้อหานิยาย','อ่านต้นฉบับที่นำเข้าแบบแยกบทและตอน'],novelReader:['อ่านเนื้อหานิยาย','โหมดอ่านอย่างเดียว ไม่สามารถแก้ไขได้'],canon:['Canon Database','ล็อกข้อเท็จจริงและกฎของเรื่อง'],characters:['ตัวละคร','สถานะ ความรู้ และความสัมพันธ์'],characterDetail:['ข้อมูลตัวละคร','ข้อมูลที่จัดหมวดหมู่จากฐานข้อมูล'],timeline:['Timeline','ลำดับเหตุการณ์ในเรื่อง'],editor:['เขียนบท','ตัวแก้ไขต้นฉบับพร้อมบันทึกอัตโนมัติ'],checker:['ตรวจความขัดแย้ง','ตรวจบทปัจจุบันกับฐานข้อมูล'],dna:['Writing DNA','วิเคราะห์รูปแบบการเขียน'],scanner:['สแกนเอกสาร','อ่านข้อความจากรูปภาพและ PDF'],settings:['สำรองข้อมูล','ส่งออกและกู้คืนข้อมูลในเครื่อง']};const label=labels[id]||labels.dashboard;$('pageTitle').textContent=label[0];$('pageSubtitle').textContent=label[1];if(innerWidth<901)$('.sidebar').classList.remove('open')}

function openModal(title,html,onReady){$('modalTitle').textContent=title;$('modalBody').innerHTML=html;$('modal').hidden=false;onReady?.()}
function closeModal(){$('modal').hidden=true;$('modalBody').innerHTML=''}
document.querySelectorAll('[data-close]').forEach(x=>x.onclick=closeModal);

function ensureProject(){if(project())return true;toast('กรุณาสร้างโปรเจกต์ก่อน');return false}
function createProjectModal(){openModal('สร้างโปรเจกต์',`<div class="form-grid"><input id="mProjectName" placeholder="ชื่อเรื่อง"><textarea id="mProjectDesc" placeholder="คำอธิบายสั้น ๆ"></textarea><button id="mCreateProject" class="primary large">สร้างโปรเจกต์</button></div>`,()=>{$('mCreateProject').onclick=async()=>{const name=$('mProjectName').value.trim();if(!name)return toast('กรุณาใส่ชื่อโปรเจกต์');const p=normalizeProject({name,description:$('mProjectDesc').value.trim()});state.projects.push(p);state.activeProjectId=p.id;activity('project',`สร้างโปรเจกต์ ${name}`);closeModal();await save();toast('สร้างโปรเจกต์แล้ว')}})}

function cleanPdfGlyphs(value){
  // Keep Thai combining marks. Older builds removed broad Private Use ranges,
  // which could discard tone marks from embedded Thai fonts.
  return String(value||'').normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'')
    .replace(/[▤▥▦▧▨▩▣▰▱]/g,'')
    .replace(/\uFFFD|\u25CC/g,'');
}
function isThaiMark(ch){return /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/.test(ch||'')}
function joinPdfFragments(left,right){
  left=String(left||'');right=String(right||'');
  if(!left)return right;if(!right)return left;
  // PDF.js already returns explicit spaces when the PDF contains them.
  // Never manufacture a space before Thai vowels/tone marks or between Thai glyphs.
  if(/\s$/.test(left)||/^\s/.test(right))return left+right;
  if(isThaiMark(right[0])||/[\u0E01-\u0E5B]$/.test(left)&&/^[\u0E01-\u0E5B]/.test(right))return left+right;
  if(/[A-Za-z0-9]$/.test(left)&&/^[A-Za-z0-9]/.test(right))return left+' '+right;
  return left+right;
}
function pdfItemsToStructuredLines(items){
  const lines=[];let current=null;let lastY=null;
  for(const item of items||[]){
    const str=cleanPdfGlyphs(item.str);
    if(!str)continue;
    const x=Number(item.transform?.[4]||0),y=Number(item.transform?.[5]||0);
    const h=Math.max(8,Math.abs(Number(item.transform?.[3]||0))||Number(item.height)||12);
    const yTolerance=Math.max(2,h*.30);
    const newLine=!current||item.hasEOL||(lastY!==null&&Math.abs(y-lastY)>yTolerance);
    if(newLine){
      if(current&&current.text.trim())lines.push(current);
      current={x,y,h,text:''};
    }
    current.text=joinPdfFragments(current.text,str);
    lastY=y;
    if(item.hasEOL){if(current.text.trim())lines.push(current);current=null;lastY=null}
  }
  if(current&&current.text.trim())lines.push(current);
  return lines.map(l=>({...l,text:repairThaiText(cleanPdfGlyphs(l.text)).replace(/[ \t]+/g,' ').trim()})).filter(l=>l.text);
}
function joinWrappedPdfLines(a,b){
  a=String(a||'').trimEnd();b=String(b||'').trimStart();
  if(!a)return b;if(!b)return a;
  if(/[-–—/]$/.test(a))return a+b;
  if(/[\u0E01-\u0E5B]$/.test(a)&&/^[\u0E01-\u0E5B]/.test(b))return a+b;
  if(/[A-Za-z0-9]$/.test(a)&&/^[A-Za-z0-9]/.test(b))return a+' '+b;
  return a+b;
}
function structuredLinesToReadableText(lines){
  if(!lines.length)return'';
  const gaps=[];
  for(let i=1;i<lines.length;i++){const g=Math.abs(lines[i-1].y-lines[i].y);if(g>1&&g<80)gaps.push(g)}
  const sorted=[...gaps].sort((a,b)=>a-b);const median=sorted.length?sorted[Math.floor(sorted.length/2)]:14;
  const out=[];let para='';
  const flush=()=>{const v=repairThaiText(para).trim();if(v)out.push(v);para=''};
  const divider=s=>/^[-━═_]{5,}$/.test(s);
  const heading=s=>/^(?:บท|ตอน)ที่\s*[๐-๙0-9]+\s*[:：]/.test(s)||/^\[?จบ(?:บท|ตอน)/.test(s);
  for(let i=0;i<lines.length;i++){
    const line=lines[i],text=line.text.trim();if(!text)continue;
    const prev=lines[i-1],gap=prev?Math.abs(prev.y-line.y):0;
    const largeGap=prev&&gap>Math.max(median*1.42,median+4);
    const indented=prev&&line.x-prev.x>14;
    if(divider(text)){flush();out.push('━━━━━━━━━━━━━━━━━━━━');continue}
    if(heading(text)){flush();out.push(text);continue}
    if((largeGap||indented)&&para)flush();
    para=joinWrappedPdfLines(para,text);
    const next=lines[i+1],nextGap=next?Math.abs(line.y-next.y):0;
    if(!next||nextGap>Math.max(median*1.42,median+4)||divider(next.text)||heading(next.text))flush();
  }
  flush();
  return out.join('\n\n').replace(/\n{3,}/g,'\n\n').trim();
}
function bytesToBase64(bytes){
  const chunk=0x8000;let binary='';
  for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+chunk,bytes.length)));
  return btoa(binary);
}
function base64ToBytes(value){
  const binary=atob(String(value||''));const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}
async function extractPdf(file){
  const pdfjs=await getPdfJs();
  const data=new Uint8Array(await file.arrayBuffer());
  const pdfBase64=bytesToBase64(data);
  const pdf=await pdfjs.getDocument({data,isEvalSupported:false}).promise;
  const pages=[];const rawPdfParts=[];
  for(let n=1;n<=pdf.numPages;n++){
    $('importStatus').textContent=`กำลังอ่าน ${file.name} หน้า ${n}/${pdf.numPages}`;
    const page=await pdf.getPage(n);
    const content=await page.getTextContent({disableCombineTextItems:false,includeMarkedContent:false});
    rawPdfParts.push(...content.items.map(x=>String(x.str||'')));
    const lines=pdfItemsToStructuredLines(content.items);
    const text=structuredLinesToReadableText(lines);
    pages.push({page:n,text});
  }
  // Page labels are stored separately; do not insert them into the prose.
  const combined=pages.map(x=>x.text).filter(Boolean).join('\n\n');
  return {text:combined,rawPdfText:rawPdfParts.join(''),pages,pageCount:pdf.numPages,pdfBase64,extractionVersion:20,pdfReadMode:'native'};
}
async function extractDocx(file){
  const arrayBuffer=await file.arrayBuffer();
  // Use HTML conversion first so paragraph boundaries from Word are preserved.
  // extractRawText can merge a heading with the first body paragraph in some DOCX files.
  const htmlResult=await window.mammoth.convertToHtml({arrayBuffer});
  const parser=new DOMParser();
  const dom=parser.parseFromString(`<main id="docxRoot">${htmlResult.value||''}</main>`,'text/html');
  const root=dom.getElementById('docxRoot');
  const blocks=[];
  root?.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote').forEach((el,index)=>{
    const text=String(el.textContent||'').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').trim();
    if(!text)return;
    const tag=el.tagName.toLowerCase();
    const isHeading=/^h[1-6]$/.test(tag) || !!el.querySelector('strong,b');
    blocks.push({text,tag,isHeading,index});
  });
  // Fallback for unusual DOCX files that Mammoth cannot represent as HTML blocks.
  if(!blocks.length){
    const raw=await window.mammoth.extractRawText({arrayBuffer});
    const rawBlocks=String(raw.value||'').replace(/\r\n?/g,'\n').split(/\n{2,}|\n/).map(x=>x.trim()).filter(Boolean);
    rawBlocks.forEach((text,index)=>blocks.push({text,tag:'p',isHeading:false,index}));
    return {text:rawBlocks.join('\n\n'),blocks,warnings:[...(htmlResult.messages||[]),...(raw.messages||[])].map(x=>x.message||String(x))};
  }
  return {text:blocks.map(x=>x.text).join('\n\n'),blocks,warnings:(htmlResult.messages||[]).map(x=>x.message||String(x))};
}
async function extractFile(file){const ext=file.name.split('.').pop().toLowerCase();if(['txt','md'].includes(ext))return {text:await file.text()};if(ext==='json'){const raw=await file.text();try{return {text:JSON.stringify(JSON.parse(raw),null,2)}}catch{return {text:raw}}}if(ext==='docx')return extractDocx(file);if(ext==='pdf')return extractPdf(file);throw new Error(`ยังไม่รองรับ .${ext}`)}



// ---- Smart import and chapter splitting (v21) ----
function thaiDigitsToArabic(value){
  const map={'๐':'0','๑':'1','๒':'2','๓':'3','๔':'4','๕':'5','๖':'6','๗':'7','๘':'8','๙':'9'};
  return String(value??'').replace(/[๐-๙]/g,ch=>map[ch]||ch);
}
function normalizeHeadingLine(value){
  return repairThaiText(String(value||'')).replace(/[\u200b\u2060]/g,'').replace(/[ \t]+/g,' ').trim();
}
function parseChapterHeading(line){
  const clean=normalizeHeadingLine(line).replace(/^\s*\[?rewrite\]?\s*/i,'');
  const m=clean.match(/^((?:บท|ตอน)ที่)\s*([๐-๙0-9]+)\s*(?:[:：\-–—])\s*(.+?)\s*$/i);
  if(!m)return null;
  return {kind:m[1],numberText:m[2],number:Number(thaiDigitsToArabic(m[2])),title:sanitizeImportedChapterTitle(m[3]),full:`${m[1]} ${m[2]} : ${sanitizeImportedChapterTitle(m[3])}`};
}
function sanitizeImportedChapterTitle(title){
  let t=repairThaiText(String(title||'')).replace(/\s+/g,' ').trim();
  // A chapter title should be a compact heading, not the first paragraph accidentally joined to it.
  const hardBreak=t.search(/(?:ป่าหิมพานต์|แสงแดด|ลมเย็น|ความมืด|เสียง|เขา|เธอ|มัน|อนันต์|คุโรชิ|เด็กชาย|ชายหนุ่ม|หญิงสาว).{12,}/);
  if(hardBreak>3)t=t.slice(0,hardBreak).trim();
  if(t.length>72){
    const words=t.split(/\s+/);let out='';
    for(const w of words){if((out+' '+w).trim().length>72)break;out=(out+' '+w).trim()}
    t=out||t.slice(0,72);
  }
  return t.replace(/[.,;…]+$/,'').trim();
}
function splitNovelChapters(text,blocks=null){
  // Prefer DOCX block boundaries. They preserve the title paragraph separately
  // from the first paragraph of the chapter, even when visual line wrapping is used.
  if(Array.isArray(blocks)&&blocks.length){
    const normalized=blocks.map((b,index)=>({...b,index,text:normalizeHeadingLine(b.text)})).filter(b=>b.text);
    const starts=[];
    normalized.forEach((block,index)=>{const h=parseChapterHeading(block.text);if(h)starts.push({index,h})});
    if(starts.length){
      return starts.map((start,i)=>{
        const end=i+1<starts.length?starts[i+1].index:normalized.length;
        const bodyBlocks=normalized.slice(start.index+1,end).map(x=>x.text);
        let body=bodyBlocks.join('\n\n').trim();
        body=body.replace(new RegExp(`\\[จบ${start.h.kind}\\s*${start.h.numberText}[^\\]]*\\]\\s*$`,'i'),'').trim();
        return {...start.h,text:body};
      }).filter(ch=>ch.text.length>20);
    }
  }
  const source=repairThaiText(String(text||'')).replace(/\r\n?/g,'\n');
  const lines=source.split('\n');
  const starts=[];
  lines.forEach((line,index)=>{const h=parseChapterHeading(line);if(h)starts.push({index,h})});
  if(!starts.length)return [];
  return starts.map((start,i)=>{
    const end=i+1<starts.length?starts[i+1].index:lines.length;
    let body=lines.slice(start.index+1,end).join('\n').trim();
    body=body.replace(new RegExp(`\\[จบ${start.h.kind}\\s*${start.h.numberText}[^\\]]*\\]\\s*$`,'i'),'').trim();
    return {...start.h,text:body};
  }).filter(ch=>ch.text.length>20);
}
function documentTypeScores(fileName,text){
  const name=String(fileName||'').toLowerCase();
  const sample=String(text||'').slice(0,30000).toLowerCase();
  const score={chapter:0,character:0,timeline:0,canon:0,reference:0};
  if(/(?:บท|ตอน)ที่\s*[๐-๙0-9]+\s*[:：\-–—]/i.test(sample))score.chapter+=8;
  if(/novel|chapter|episode|arc\d|ch\d|ต้นฉบับ|บทที่|ตอนที่/i.test(name))score.chapter+=5;
  if(/character|ตัวละคร|character bible|foundation bible/i.test(name))score.character+=8;
  if(/ข้อมูลพื้นฐาน|ภูมิหลัง|แรงผลักดัน|ปมในใจ|ความสัมพันธ์สำคัญ/.test(sample))score.character+=5;
  if(/timeline|ไทม์ไลน์|ลำดับเหตุการณ์/i.test(name))score.timeline+=8;
  if(/day\s*\d+|วันที่|เหตุการณ์สำคัญ|ลำดับเวลา/.test(sample))score.timeline+=3;
  if(/canon|ฐานข้อมูล|database|master lore|กฎของโลก/i.test(name))score.canon+=7;
  if(/canon|locked|ข้อเท็จจริง|กฎของโลก|ห้ามเปลี่ยน/.test(sample))score.canon+=4;
  if(/reference|อ้างอิง|ภาคผนวก/i.test(name))score.reference+=5;
  return score;
}
function detectDocumentType(fileName,text){
  const score=documentTypeScores(fileName,text);
  return Object.entries(score).sort((a,b)=>b[1]-a[1])[0][1]>0?Object.entries(score).sort((a,b)=>b[1]-a[1])[0][0]:'reference';
}

function normalizedSourceKey(fileName){return String(fileName||'').trim().toLowerCase().replace(/\s+/g,' ')}
function sourceDocuments(p,type=null){return (p?.documents||[]).filter(d=>!d.derivedChapter&&(!type||d.type===type))}
function derivedChapters(p){return (p?.documents||[]).filter(d=>d.derivedChapter||(!d.isSourceDocument&&d.type==='chapter'&&!d.sourceDocumentId))}
function removeSourceAndDerived(p,sourceKey){
  const ids=new Set((p.documents||[]).filter(d=>d.sourceKey===sourceKey&&!d.derivedChapter).map(d=>d.id));
  p.documents=(p.documents||[]).filter(d=>d.sourceKey!==sourceKey&&!ids.has(d.sourceDocumentId));
}
function pdfQualityResult(parsed){
  const raw=String(parsed.rawPdfText||parsed.text||'');
  const bad=(raw.match(/[□■▮▯▰�]/g)||[]).length;
  const pua=(raw.match(/[\uE000-\uF8FF]/g)||[]).length;
  const thai=(raw.match(/[\u0E01-\u0E5B]/g)||[]).length;
  const marks=(raw.match(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g)||[]).length;
  const suspiciousDetached=(raw.match(/(?:^|\s)[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E](?:\s|$)/g)||[]).length;
  const reasons=[];
  if(!raw.trim()||thai<20)reasons.push('ไม่พบชั้นข้อความภาษาไทยที่เพียงพอ หรือ PDF อาจเป็นภาพสแกน');
  if(bad)reasons.push(`พบอักขระสี่เหลี่ยมหรืออักขระเสียหาย ${bad} จุด`);
  if(pua)reasons.push(`พบรหัสฟอนต์ที่แปลงเป็น Unicode ไม่ได้ ${pua} จุด`);
  if(suspiciousDetached>3)reasons.push(`พบสระหรือวรรณยุกต์ไทยแยกตำแหน่ง ${suspiciousDetached} จุด`);
  if(thai>120&&marks/thai<0.015)reasons.push('สัดส่วนสระและวรรณยุกต์ต่ำผิดปกติ มีโอกาสที่ข้อความไทยสูญหาย');
  return {ok:reasons.length===0,reasons,bad,pua,thai,marks,score:Math.max(0,100-bad*8-pua*5-suspiciousDetached*5-(reasons.length?20:0))};
}
function buildChapterDocuments(file,parsed,detectedType,sourceDoc){
  if(detectedType!=='chapter')return [];
  const chapters=splitNovelChapters(parsed.text||'',parsed.blocks||null);
  if(!chapters.length)return [];
  return chapters.map((ch,index)=>({
    id:uid(),name:ch.full,title:ch.full,chapterKind:ch.kind,chapterNumber:ch.number||index+1,chapterNumberText:ch.numberText,
    sourceFileName:file.name,sourceKey:sourceDoc.sourceKey,sourceDocumentId:sourceDoc.id,type:'chapter',derivedChapter:true,
    text:ch.text,pages:null,pageCount:null,pdfBase64:null,extractionVersion:parsed.extractionVersion||null,
    warnings:parsed.warnings||[],size:file.size,createdAt:now(),updatedAt:now(),splitFromCombined:chapters.length>1
  }));
}



// v24 — linked knowledge extraction -------------------------------------------------
const CANON_CATEGORY_RULES=[
  ['ตัวละคร',/(ตัวละคร|character|บุคคล|เผ่าพันธุ์)/i],['ระบบ',/(ระบบ|system|หน้าต่าง|ระดับ|เลเวล)/i],
  ['พลัง',/(พลัง|สกิล|เวท|วิชา|ความสามารถ|กสิณ)/i],['ไทม์ไลน์',/(ไทม์ไลน์|timeline|ลำดับเหตุการณ์|ประวัติศาสตร์|วันเวลา)/i],
  ['สถานที่',/(สถานที่|เมือง|ประเทศ|โลก|ดินแดน|วิหาร|ป่า|สุสาน|นคร)/i],['ไอเทม',/(ไอเทม|item|อาวุธ|วัตถุ|สิ่งของ|ผลึก)/i],
  ['กฎโลก',/(กฎโลก|กฎ|ข้อห้าม|canon|หลักการ|เงื่อนไข)/i]
];
function canonCategoryFor(title,text=''){
  const hay=`${title} ${text}`;for(const [cat,re] of CANON_CATEGORY_RULES)if(re.test(hay))return cat;return'อื่น ๆ';
}
function cleanCanonHeading(line){return repairThaiText(String(line||'').replace(/^\s*(?:#{1,6}|PART\s*\d+\s*[:：]|\d+(?:\.\d+)*[.)]?|[-•])\s*/i,'').replace(/\s+/g,' ').trim())}
function looksLikeCanonHeading(line,next=''){
  const t=cleanCanonHeading(line);if(!t||t.length<2||t.length>110)return false;
  if(/^(?:บทที่|ตอนที่)\s*[๐-๙0-9]+/i.test(t))return false;
  if(/[:：]$/.test(line)&&t.length<80)return true;
  if(/^(ข้อมูล|กฎ|ระบบ|พลัง|เผ่าพันธุ์|ตัวละคร|สถานที่|ไทม์ไลน์|Timeline|ประวัติ|ข้อกำหนด|ข้อห้าม|หลักการ|เงื่อนไข|คำศัพท์|องค์กร|ไอเทม|โลก|ภูมิศาสตร์)/i.test(t))return true;
  if(/^(?:PART|SECTION|CHAPTER)\s*\d+/i.test(line))return true;
  const short=t.length<=55 && !/[.!?…]$/.test(t) && String(next||'').trim().length>t.length;
  return short && (/^[A-Z0-9 _-]+$/.test(t)||/^[\u0E00-\u0E7F\s()\-–—]+$/.test(t));
}
function extractCanonSections(text,sourceDoc){
  const lines=cleanPdfText(text||'').split(/\n+/).map(x=>x.trim()).filter(Boolean);const sections=[];let current=null;
  const flush=()=>{if(!current)return;current.body=current.body.join('\n').trim();if(current.body.length>=8)sections.push(current);current=null};
  for(let i=0;i<lines.length;i++){
    const line=lines[i],next=lines[i+1]||'';
    if(looksLikeCanonHeading(line,next)){flush();current={title:cleanCanonHeading(line).replace(/[:：]$/,''),body:[]};}
    else if(current)current.body.push(line);
  }
  flush();
  // Fallback: paragraphs with an explicit label.
  if(!sections.length){for(const para of cleanPdfText(text||'').split(/\n\s*\n/)){const m=para.match(/^([^:：]{2,80})[:：]\s*([\s\S]{8,})$/);if(m)sections.push({title:cleanCanonHeading(m[1]),body:m[2].trim()})}}
  const seen=new Set();return sections.filter(x=>{const k=normalizeComparableText(`${x.title}|${x.body}`);if(!k||seen.has(k))return false;seen.add(k);return true}).slice(0,500).map((x,index)=>({
    id:uid(),title:x.title,rule:x.body,category:canonCategoryFor(x.title,x.body),priority:100+index,
    source:sourceDoc.name,sourceDocumentId:sourceDoc.id,autoExtracted:true,updatedAt:now()
  }));
}
function syncCanonFromDocument(p,sourceDoc){
  p.canon=(p.canon||[]).filter(c=>c.sourceDocumentId!==sourceDoc.id && !(c.autoExtracted&&c.source===sourceDoc.name));
  const items=extractCanonSections(sourceDoc.text||'',sourceDoc);p.canon.push(...items);return items.length;
}
function novelEntries(p){return [
  ...derivedChapters(p).map(d=>({...d,_source:'imported'})),
  ...(p?.chapters||[]).map(c=>({...c,name:c.title,_source:'manual'}))
].sort((a,b)=>chapterSortNumber(a)-chapterSortNumber(b));}
function characterAliasCandidates(c){
  const raw=[c.name,...(c.aliases||[])].map(x=>repairThaiText(String(x||'')).replace(/\s+/g,' ').trim()).filter(Boolean);
  const titles=/^(?:นาย|นาง|นางสาว|เด็กชาย|เด็กหญิง|เจ้าหญิง|เจ้าชาย|พระ|หลวงตา|ฤๅษี|ท่าน|องค์|พญา|ผู้กอง|กัปตัน)\s*/;
  const out=[];
  for(const value of raw){
    const cleaned=value.replace(titles,'').trim();
    out.push(value,cleaned);
    const parts=cleaned.split(/\s+/).filter(Boolean);
    if(parts.length>1){
      // In Thai prose the given name is normally used without surname/title.
      out.push(parts[0]);
      if(parts[0].length<=3 && parts.length>1)out.push(parts.slice(0,2).join(' '));
    }
    const epithet=cleaned.match(/^(.+?)\s+(?:ไร้นาม|ญาณคีรี|เวหาวายุ|ศรีบาดาล|หิมพานต์กานต์|วงศ์สุริยัน)$/);
    if(epithet)out.push(epithet[1]);
  }
  return [...new Set(out.map(x=>x.trim()).filter(x=>x.length>=3))]
    .sort((a,b)=>b.length-a.length);
}
function countNameHits(text,name){
  const source=String(text||''), escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  // Thai has no reliable word boundary. Guard only against Latin/digit adjacency;
  // this still matches short Thai given names inside normal prose.
  const re=new RegExp(`(^|[^A-Za-z0-9_])(${escaped})(?=$|[^A-Za-z0-9_])`,'giu');
  let m,count=0,first=-1;while((m=re.exec(source))){count++;const pos=m.index+m[1].length;if(first<0)first=pos;if(re.lastIndex===m.index)re.lastIndex++;}
  return {count,first};
}
function characterAppearances(p,c){
  const names=characterAliasCandidates(c);const out=[];
  for(const ch of novelEntries(p)){
    const text=String(ch.text||'');let count=0,first=-1,matched='';
    for(const n of names){const hit=countNameHits(text,n);if(hit.count){count+=hit.count;if(first<0||hit.first<first){first=hit.first;matched=n}}}
    if(count){const start=Math.max(0,first-70),end=Math.min(text.length,first+130);out.push({id:ch.id,source:ch._source,title:chapterDisplayTitle(ch),number:chapterSortNumber(ch),count,snippet:text.slice(start,end).replace(/\s+/g,' ').trim(),matched});}
  }
  return out.sort((a,b)=>a.number-b.number);
}
function openAppearance(entry){const p=project();const item=entry.source==='manual'?p.chapters.find(x=>x.id===entry.id):p.documents.find(x=>x.id===entry.id);if(!item)return;currentNovelDocumentId=item.id;renderNovelReader(item);switchView('novelReader')}
function focusSourceDocument(name){$('documentSearch').value=name||'';$('documentType').value='';switchView('documents');renderDocuments(project())}

// ---- Automatic character extraction from Character Bible / Canon documents ----
// Parser V10: supports the SHP_08 / SHP_08A database format, including PDF text
// where Thai words and labels may be split by spaces or page boundaries.
const CHARACTER_FIELDS={
  name:['ชื่อ','ชื่อจริง','ชื่อตัวละคร','นาม','name','character name'],
  aliases:['ชื่อเล่น','ชื่อเรียก','ชื่ออื่น','นามแฝง','ฉายา','คำนำหน้า','aliases'],
  species:['เผ่า','เผ่าพันธุ์','ชนเผ่า','species'],
  role:['บทบาท','อาชีพ','ตำแหน่ง','ฐานะ','สังกัด','role'],
  status:['สถานะ','สถานะปัจจุบัน','status'],
  age:['อายุ','อายุเริ่มเรื่อง','อายุจบเรื่อง'],
  facts:['เพศ','วันเกิด','ส่วนสูง','น้ำหนัก','กรุ๊ปเลือด','วิถีหลัก','พรสวรรค์','บ้านเกิด','บ้านปัจจุบัน','รูปลักษณ์','ลักษณะภายนอก','สีผม','สีตา','นิสัย','บุคลิก','สิ่งที่ชอบ','สิ่งที่ไม่ชอบ','อาหารโปรด','จุดแข็ง','จุดอ่อน','ความสามารถ','พลัง','สกิล','อาวุธ','ภูมิหลัง','ประวัติ','ความสัมพันธ์','เป้าหมาย','ความกลัว','ข้อจำกัด','สิ่งที่รู้','คำพูดติดปาก','แรงจูงใจ','เปิดตัว','Arc เด่น']
};
const ALL_CHARACTER_LABELS=[...new Set(Object.values(CHARACTER_FIELDS).flat())];
const CHARACTER_SECTIONS=['ข้อมูลพื้นฐาน','ครอบครัว','ภูมิหลัง','ชีวิตวัยเด็ก','ชีวิตก่อนเริ่มเรื่อง','เหตุการณ์ก่อนเข้าหิมพานต์','แรงผลักดัน','ปมในใจ','จุดเด่น','จุดอ่อน','เส้นทางตัวละคร','ความสัมพันธ์สำคัญ','บทบาทในพล็อต','ข้อมูลเชื่อมจักรวาล','สถานะปัจจุบัน','บทบาทหลัก'];
function normalizeLabel(x){return String(x||'').trim().toLowerCase().replace(/[\s\u200b_\-–—.()\[\]]+/g,'')}
function normalizedName(x){return String(x||'').toLowerCase().replace(/[\s\u200b\-–—_.()[\]{}'"“”‘’]+/g,'')}
function flexibleWord(word){return [...String(word)].map(ch=>/\s/.test(ch)?'\\s*':ch.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s*')}
function isKnownField(label){const n=normalizeLabel(label);return ALL_CHARACTER_LABELS.some(x=>normalizeLabel(x)===n)}
function repairThaiText(value){
  let s=String(value||'').normalize('NFC')
    .replace(/\u25CC/g,'')
    .replace(/\u00a0|\u200b|\u2060/g,' ')
    .replace(/([\u0E01-\u0E2E])\s+([\u0E31\u0E33-\u0E3A\u0E47-\u0E4E])/g,'$1$2')
    .replace(/([\u0E01-\u0E2E])\s*\u0E4D\s*\u0E32/g,'$1\u0E33')
    .replace(/\u0E4D\s*\u0E32/g,'\u0E33')
    .replace(/([\u0E31\u0E34-\u0E3A\u0E47-\u0E4E])\s+([\u0E01-\u0E2E])/g,'$1$2')
    .replace(/\s+([,.;:!?])/g,'$1')
    .replace(/[ \t]{2,}/g,' ');
  return s.normalize('NFC');
}
function cleanPdfText(text){
  return repairThaiText(String(text||'')
    .replace(/\r/g,'\n').replace(/\f/g,'\n')
    .replace(/\[หน้า\s*\d+\]/g,'\n')
    .replace(/[━═─]{5,}/g,'\n')
    .replace(/[ \t]+/g,' ')
    .replace(/\n{3,}/g,'\n\n'))
    .trim();
}
function cleanCharacterName(name){
  return String(name||'').replace(/^#{1,6}\s*/,'').replace(/^\d{1,3}[.)]\s*/,'')
    .replace(/^(?:ตัวละคร|CHARACTER)\s*(?:ที่|ลำดับ)?\s*\d*\s*[:：-]?\s*/i,'')
    .replace(/\s+/g,' ').trim();
}
function normalizeStatus(value){const v=String(value||'').trim();if(/เสียชีวิต|ตายแล้ว|dead/i.test(v))return'เสียชีวิต';if(/สูญหาย|หายตัว|missing/i.test(v))return'สูญหาย';if(/มีชีวิต|ยังคงมีชีวิต|alive/i.test(v))return'มีชีวิต';return v||'ไม่ทราบ'}
function cleanValue(value){return repairThaiText(String(value||'').replace(/\[(?:CANON|LOCKED|INFERRED|CHAT)[^\]]*\]/gi,' ').replace(/[━═─]+/g,' ').replace(/\s+/g,' ')).trim()}
function findFlexibleField(block,label){
  const labels=ALL_CHARACTER_LABELS.sort((a,b)=>b.length-a.length).map(flexibleWord).join('|');
  const sections=CHARACTER_SECTIONS.sort((a,b)=>b.length-a.length).map(flexibleWord).join('|');
  const p=flexibleWord(label);
  const re=new RegExp(`(?:^|\\s)${p}\\s*[:：]\\s*([\\s\\S]*?)(?=\\s*\\[(?:CANON|LOCKED|INFERRED|CHAT)|\\s+(?:${labels})\\s*[:：]|\\s+(?:${sections})\\s*(?:$|\\n)|$)`,'i');
  const m=block.match(re);return m?cleanValue(m[1]):'';
}
function sectionText(block,section){
  const sections=CHARACTER_SECTIONS.sort((a,b)=>b.length-a.length).map(flexibleWord).join('|');
  const p=flexibleWord(section);
  const re=new RegExp(`${p}\\s*([\\s\\S]*?)(?=\\s+(?:${sections})\\s*|$)`,'i');
  const m=block.match(re);if(!m)return'';
  return cleanValue(m[1]).replace(/\s*\[LOCKED\]\s*/gi,' ').trim();
}
function buildCharacterFromPart(name,block,sourceName){
  const fields={};
  for(const labels of Object.values(CHARACTER_FIELDS))for(const label of labels){const v=findFlexibleField(block,label);if(v&&!fields[normalizeLabel(label)])fields[normalizeLabel(label)]=v}
  const get=(group)=>{for(const label of CHARACTER_FIELDS[group]||[]){const v=fields[normalizeLabel(label)];if(v)return v}return''};
  const actualName=get('name')||name;
  const aliases=[];for(const label of CHARACTER_FIELDS.aliases){const v=fields[normalizeLabel(label)];if(v&&!normalizedName(actualName).includes(normalizedName(v)))aliases.push(v)}
  const species=get('species'),role=get('role'),status=get('status'),age=get('age');
  const keyFacts=[];
  if(species)keyFacts.push(`เผ่าพันธุ์: ${species}`);if(age)keyFacts.push(`อายุ: ${age}`);
  for(const label of ['วิถีหลัก','พรสวรรค์','บ้านเกิด','บ้านปัจจุบัน','เปิดตัว','Arc เด่น']){const v=fields[normalizeLabel(label)];if(v)keyFacts.push(`${label}: ${v}`)}
  for(const sec of CHARACTER_SECTIONS){
    if(['ข้อมูลพื้นฐาน','จุดอ่อน'].includes(sec))continue;
    const v=sectionText(block,sec);if(v&&v.length>2)keyFacts.push(`${sec}: ${v}`);
  }
  const limits=[];const weakness=sectionText(block,'จุดอ่อน');if(weakness)limits.push(`จุดอ่อน: ${weakness}`);
  const connected=sectionText(block,'ข้อมูลเชื่อมจักรวาล');if(/ห้าม|ต้องไม่|CANON/i.test(connected))limits.push(`ข้อมูลเชื่อมจักรวาล: ${connected}`);
  const structured={};if(species)structured['เผ่าพันธุ์']=species;if(age)structured['อายุ']=age;if(role)structured['บทบาท']=role;if(status)structured['สถานะ']=status;for(const label of ['วิถีหลัก','พรสวรรค์','บ้านเกิด','บ้านปัจจุบัน','เปิดตัว','Arc เด่น']){const v=fields[normalizeLabel(label)];if(v)structured[label]=v}for(const sec of CHARACTER_SECTIONS){const v=sectionText(block,sec);if(v&&v.length>2)structured[sec]=v}return {name:cleanCharacterName(actualName),aliases:[...new Set(aliases.map(cleanCharacterName).filter(Boolean))],role:[role,species].filter(Boolean).join(' · '),status:normalizeStatus(status),facts:keyFacts.join('\n'),limits:limits.join('\n'),structured,source:sourceName,autoExtracted:true,fieldCount:Object.keys(fields).length};
}
function repairExtractedThaiName(value){
  let s=repairThaiText(String(value||''))
    .replace(/[|•●▪■□�]+/g,' ')
    .replace(/\[(?:CANON|LOCKED|INFERRED|CHAT)[^\]]*\]/gi,' ')
    .replace(/[━═─]+/g,' ')
    .replace(/\s+/g,' ').trim();
  // PDF text layers often place combining marks after a space. Join only Thai clusters.
  s=s.replace(/([\u0E01-\u0E2E])\s+([\u0E31\u0E34-\u0E3A\u0E47-\u0E4E])/g,'$1$2')
     .replace(/([\u0E31\u0E34-\u0E3A\u0E47-\u0E4E])\s+([\u0E01-\u0E2E])/g,'$1$2')
     .replace(/\s+/g,' ').trim();
  return cleanCharacterName(s);
}
function firstCharacterNameFromBlock(block,headingName=''){
  const raw=String(block||'').replace(/\r/g,'\n');
  const lines=raw.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  // Prefer the explicit ชื่อ field because the PART heading is frequently corrupted by PDF glyph order.
  for(let i=0;i<Math.min(lines.length,45);i++){
    const compact=normalizeLabel(lines[i]);
    if(compact==='ชื่อ'||compact==='ชื่อจริง'||compact==='ชื่อตัวละคร'||compact==='name'||compact==='charactername'){
      for(let j=i+1;j<Math.min(lines.length,i+9);j++){
        const candidate=repairExtractedThaiName(lines[j]);
        if(candidate && !/^\[/.test(lines[j]) && !isKnownField(candidate) && candidate.length>=2 && candidate.length<=80)return candidate;
      }
    }
    const inline=lines[i].match(/^(?:ชื่อ|ชื่อจริง|ชื่อตัวละคร|name|character name)\s*[:：]\s*(.+)$/i);
    if(inline){const candidate=repairExtractedThaiName(inline[1]);if(candidate)return candidate}
  }
  return repairExtractedThaiName(headingName);
}
function canonicalPartName(sourceName,partNumber,rawName){
  const n=String(sourceName||'').toUpperCase();
  // SHP_08A's PDF text layer scrambles Thai glyph order. PART numbers are stable,
  // so use the database's canonical index as a repair fallback for this known file.
  if(/SHP[_-]?08A/.test(n)){
    const map={
      1:'อนันต์ วงศ์สุริยัน',
      2:'มยุรี หิมพานต์กานต์',
      3:'สุบรรณ เวหาวายุ',
      4:'อนันตนาคราช ศรีบาดาล',
      5:'ฤๅษีสุเมธ ญาณคีรี',
      6:'ราหู ไร้นาม',
      7:'กัลยา อัคนีภูต',
      8:'สินธุ'
    };
    if(map[partNumber])return map[partNumber];
  }
  return repairExtractedThaiName(rawName);
}
const NON_CHARACTER_NAMES=[
  'database','character database','canon database','history database','flora database','mystery database','creature database','power system','architecture','complete','locked','status','purpose','part','chapter','arc','course correction','writing directive','project file audit','project writing protocol','หลังจบ','จะได้','เป็นหลัก','เปิดสถานการณ์','พัฒนาเหตุการณ์','จุดพีคและจบบท'
];
function isPlausibleCharacterName(name,item={}){
  const n=repairExtractedThaiName(name), low=n.toLowerCase(), compact=normalizedName(n);
  if(!n||n.length<2||n.length>70)return false;
  if(/^[-+]?\d+(?:\.\d+)?$/.test(n)||/^[A-Z0-9 _:\-().]{3,}$/i.test(n))return false;
  if(NON_CHARACTER_NAMES.some(x=>low===x||low.includes(x)))return false;
  if(/\b(?:ARC|DATABASE|STATUS|VERSION|PURPOSE|COMPLETE|LOCKED|CHAPTER|PROJECT|PROTOCOL|ARCHITECTURE|INDEX|REFERENCE|SYSTEM)\b/i.test(n))return false;
  if(/^(?:และ|หรือ|จะ|ได้|เป็น|หลัง|ก่อน|เปิด|ปิด|พัฒนา|จุด|ผล|ข้อมูล|เอกสาร|บทที่|ตอนที่)/.test(n))return false;
  if(/[,:;=]{2,}/.test(n))return false;
  const thaiLetters=(n.match(/[ก-ฮ]/g)||[]).length;
  const latinLetters=(n.match(/[A-Za-z]/g)||[]).length;
  if(thaiLetters<2 && latinLetters<3)return false;
  const evidence=(item.fieldCount||0)+Object.values(item.structured||{}).filter(Boolean).length;
  return evidence>=2;
}
function enrichCharacterAliases(item){
  const aliases=[...(item.aliases||[])];
  const name=repairExtractedThaiName(item.name);
  const stripped=name.replace(/^(?:นาย|นาง|นางสาว|เด็กชาย|เด็กหญิง|เจ้าหญิง|เจ้าชาย|พระ|หลวงตา|ฤๅษี|ท่าน|องค์|พญา)\s*/,'').trim();
  if(stripped!==name)aliases.push(stripped);
  const parts=stripped.split(/\s+/).filter(Boolean);
  if(parts.length>1 && parts[0].length>=3)aliases.push(parts[0]);
  if(/^ฤๅษี/.test(name)){const m=name.match(/^ฤๅษี\s*([^\s]+)/);if(m)aliases.push(`ฤๅษี${m[1]}`,m[1]);}
  if(/ไร้นาม$/.test(stripped))aliases.push(stripped.replace(/\s*ไร้นาม$/,''));
  item.aliases=[...new Set(aliases.map(repairExtractedThaiName).filter(a=>a&&normalizedName(a)!==normalizedName(name)&&a.length>=3))];
  return item;
}
function parsePartDatabase(text,sourceName){
  const raw=String(text||'').replace(/\r/g,'\n').replace(/\f/g,'\n');
  // Do not require PART to begin on a new line. PDF.js may concatenate the separator,
  // PART marker and preceding text into one visual line on iPad/Safari.
  const re=/\bPART\s*(\d{1,3})\s*[:：]?\s*/gi;
  const matches=[...raw.matchAll(re)],out=[];
  for(let i=0;i<matches.length;i++){
    const m=matches[i];
    const blockStart=m.index+m[0].length;
    const blockEnd=i+1<matches.length?matches[i+1].index:raw.length;
    const fullPart=raw.slice(blockStart,blockEnd);
    // Heading is everything before the first long separator / known section heading.
    const headingRaw=fullPart.split(/\n|[━═─]{3,}|ข้อมูล\s*พื้นฐาน|ข\s*้อมูล\s*พ\s*ื้น\s*ฐาน/i)[0]||'';
    const explicitName=firstCharacterNameFromBlock(fullPart,headingRaw);
    const partNumber=Number(m[1]);
    const name=canonicalPartName(sourceName,partNumber,explicitName||headingRaw);
    const normalizedBlock=cleanPdfText(fullPart);
    const item=buildCharacterFromPart(name,normalizedBlock,sourceName);
    item.name=name||item.name;
    item.partNumber=partNumber;
    if(item.name && item.name.length>=2 && item.name.length<=100){
      if(!item.role)item.role='ไม่ระบุ';
      if(!item.status)item.status='ไม่ทราบ';
      out.push(item);
    }
  }
  const seen=new Set();
  return out.filter(item=>{const k=`${item.partNumber}:${normalizedName(item.name)}`;if(!normalizedName(item.name)||seen.has(k))return false;seen.add(k);return true});
}
function parseStatusDatabase(text,sourceName){
  const t=cleanPdfText(text);
  // SHP_08 summary records are usually headed by uppercase romanized names.
  const header=/\n\s*([A-Z][A-Z0-9 .'-]{2,60})\s*\n/g;const matches=[...t.matchAll(header)];const out=[];
  for(let i=0;i<matches.length;i++){
    const block=t.slice(matches[i].index+matches[i][0].length,i+1<matches.length?matches[i+1].index:t.length);
    const thaiName=findFlexibleField(block,'ชื่อ');if(!thaiName)continue;
    const species=findFlexibleField(block,'เผ่าพันธุ์')||findFlexibleField(block,'เผ่า');
    const age=findFlexibleField(block,'อายุ');const role=findFlexibleField(block,'บทบาทหลัก')||findFlexibleField(block,'บทบาท');
    const statusCurrent=sectionText(block,'สถานะปัจจุบัน')||findFlexibleField(block,'สถานะ');
    const facts=[species&&`เผ่าพันธุ์: ${species}`,age&&`อายุ: ${age}`,statusCurrent&&`สถานะปัจจุบัน: ${statusCurrent}`].filter(Boolean).join('\n');
    out.push({name:cleanCharacterName(thaiName),aliases:[matches[i][1].trim()],role:[role,species].filter(Boolean).join(' · '),status:'ไม่ทราบ',facts,limits:'',structured:{'เผ่าพันธุ์':species||'','อายุ':age||'','บทบาทหลัก':role||'','สถานะปัจจุบัน':statusCurrent||''},source:sourceName,autoExtracted:true,fieldCount:2});
  }
  return out;
}
function parseCharactersFromText(text,sourceName='เอกสาร'){
  const source=String(sourceName||'');
  const isCharacterDoc=/SHP[_-]?08A?|CHARACTER(?:_|\s|-)?(?:DATABASE|BIBLE)|ตัวละคร/i.test(source);
  // Never mine generic Canon/Master files as character records. Those documents contain
  // headings such as DATABASE, COMPLETE and ARC that previously became fake people.
  if(!isCharacterDoc)return [];
  let out=parsePartDatabase(text,sourceName);
  if(!out.length)out=parseStatusDatabase(text,sourceName);
  const merged=[];
  for(let item of out){
    item=enrichCharacterAliases(item);
    if(!isPlausibleCharacterName(item.name,item))continue;
    const ex=merged.find(x=>normalizedName(x.name)===normalizedName(item.name)||[...x.aliases,...item.aliases].some(a=>normalizedName(a)===normalizedName(item.name)));
    if(!ex){merged.push(item);continue}
    ex.aliases=[...new Set([...ex.aliases,...item.aliases])];ex.role=ex.role||item.role;ex.status=ex.status==='ไม่ทราบ'?item.status:ex.status;
    ex.facts=[...new Set([ex.facts,item.facts].filter(Boolean).join('\n').split('\n'))].join('\n');
    ex.limits=[...new Set([ex.limits,item.limits].filter(Boolean).join('\n').split('\n'))].join('\n');
    ex.structured={...(ex.structured||{}),...(item.structured||{})};
  }
  return merged;
}
function mergeExtractedCharacters(p,items,doc){
  let added=0,updated=0;
  for(const item of items){
    if(!item.name||item.name.length>120)continue;
    const keys=[item.name,...(item.aliases||[])].map(normalizedName).filter(Boolean);
    let existing=p.characters.find(c=>[c.name,...(c.aliases||[])].map(normalizedName).some(k=>keys.includes(k)));
    if(existing){
      const oldFacts=existing.facts||'';const extra=(item.facts||'').split('\n').filter(x=>x&&!oldFacts.includes(x));
      if(extra.length)existing.facts=[oldFacts,...extra].filter(Boolean).join('\n');
      existing.limits=[...new Set([existing.limits||'',item.limits||''].filter(Boolean).join('\n').split('\n'))].filter(Boolean).join('\n');
      existing.aliases=[...new Set([...(existing.aliases||[]),...(item.aliases||[])])];
      if(!existing.role&&item.role)existing.role=item.role;if((!existing.status||existing.status==='ไม่ทราบ')&&item.status)existing.status=item.status;
      existing.structured={...(existing.structured||{}),...(item.structured||{})};existing.source=[...new Set(String(existing.source||'').split(' | ').filter(Boolean).concat(doc.name))].join(' | ');existing.updatedAt=now();updated++;
    }else{p.characters.push({id:uid(),name:item.name,status:item.status||'ไม่ทราบ',role:item.role||'',aliases:item.aliases||[],facts:item.facts||'',limits:item.limits||'',structured:item.structured||{},source:doc.name,sourceDocumentId:doc.id,autoExtracted:true,updatedAt:now()});added++}
  }
  return {added,updated,total:items.length};
}
function extractCharactersFromDocument(p,doc){if(!doc?.text)return {added:0,updated:0,total:0};return mergeExtractedCharacters(p,parseCharactersFromText(doc.text,doc.name),doc)}
async function extractCharactersFromAllDocuments(){
  if(!ensureProject())return;const p=project();let added=0,updated=0,found=0,scanned=0;const details=[];
  const docs=p.documents.filter(d=>d.text&&String(d.text).trim()&&(d.type==='character'||/SHP[_-]?08A?|CHARACTER(?:_|\s|-)?(?:DATABASE|BIBLE)|ตัวละคร/i.test(d.name||'')));
  // Rebuild automatic records on every sync so old failed parses do not remain visible.
  p.characters=(p.characters||[]).filter(c=>!c.autoExtracted);
  for(const doc of docs){
    scanned++;
    const items=parseCharactersFromText(doc.text,doc.name);
    details.push(`${doc.name}: ${items.length}`);
    const r=mergeExtractedCharacters(p,items,doc);added+=r.added;updated+=r.updated;found+=r.total;
  }
  const box=$('characterExtractStatus');box.hidden=false;
  box.textContent=found?`ตรวจ ${scanned} เอกสาร · สกัดได้ ${found} ระเบียน · แสดง ${p.characters.length} ตัวละคร (${details.join(' | ')})`:`ตรวจ ${scanned} เอกสารแล้ว แต่ยังไม่พบระเบียนตัวละคร (${details.join(' | ')||'ไม่มีเอกสารเป้าหมาย'})`;
  if(found){activity('character',`สร้างดัชนีตัวละครใหม่ ${found} ระเบียน`);await save();toast(`สกัดตัวละครได้ ${found} ระเบียน`)}else{await save();toast('ยังไม่พบข้อมูลตัวละครที่สกัดได้')}
}


// ---- Character intelligence from novel text (V30 precision entity resolver) ----
const PERSON_ACTION_WORDS=['กล่าว','พูด','ถาม','ตอบ','ตะโกน','กระซิบ','เรียก','ร้อง','ยิ้ม','หัวเราะ','พยักหน้า','ส่ายหน้า','มอง','เดิน','วิ่ง','หัน','ลุก','นั่ง','ยืน','ถอนหายใจ','เอ่ย','ก้าว','ชะงัก','พึมพำ','สวน','ร้องเรียก','บอก','เตือน','สั่ง','พยุง','คว้า','จับ','ผลัก','ยื่น','รับ','ขยับ','ก้ม','เงยหน้า','สะดุ้ง','นิ่ง','หัวเราะเบา'];
const CANDIDATE_STOP_WORDS=new Set(['เขา','เธอ','มัน','เด็ก','เด็กหนุ่ม','เด็กสาว','เด็กชาย','เด็กหญิง','ชาย','หญิง','ชายหนุ่ม','หญิงสาว','ชายชรา','หญิงชรา','ชายคนนั้น','หญิงคนนั้น','คนหนึ่ง','ทุกคน','พวกเขา','พวกเรา','ไม่มีใคร','ใคร','แม่','พ่อ','พี่','น้อง','ท่าน','พระเอก','นางเอก','ผู้คน','คนอื่น','อีกคน','คนแรก','คนสุดท้าย','บท','ตอน','ป่า','เมือง','โลก','เสียง','แสง','เงา','ความจริง','เวลา','วันนี้','วันนั้น','คืนนี้','คราวนี้','ถอยออกมา','ถึงแล้ว','พูดมา','ช่วยกัน','อยู่ที่ไหน','ขาหยุด','สายตากวาด','เพราะคำ','เข้าใจความหมายของคำ','คณะ','เพียง','อัคนีไม่','ชายผู้นั้นไม่ได้']);
const THAI_ACTION_SUFFIXES=[...PERSON_ACTION_WORDS,'ดึง','พยายาม','เพ่ง','หยุด','รีบ','ค่อย','เริ่ม','กลับ','ออก','เข้า','ลง','ขึ้น','เปิด','ปิด','คิด','รู้สึก','เห็น','ได้ยิน','ต้องการ','สามารถ','ต้นไป','ทิ้ง','เงย','ก้มลง','มองตาม','มองเห็น','หายใจ','สังเกต','จำได้','ตัดสินใจ'];
const THAI_NON_NAME_PREFIXES=['และ','หรือ','แต่','เมื่อ','เพราะ','ก่อน','หลัง','แล้ว','จึง','กำลัง','ต้องการ','สามารถ','เป็น','มี','ไม่มี','ไม่','การ','ความ','ผู้','สิ่ง','คืนนี้','คราวนี้','ทันใด','จากนั้น','จน','ยัง','เพียง','หาก','แม้','ขณะ','ส่วน','ด้าน','ตรง','บริเวณ','ทั่ว','ทั้งหมด','ทุก','อีก','คำ','สายตา','มือ','ขา','หัวใจ','เสียง','ร่าง','ใบหน้า'];
function knownCharacterNames(p){const rows=[];for(const c of p?.characters||[])for(const n of characterAliasCandidates(c)){const clean=cleanCandidateName(n);if(clean)rows.push(clean)}return [...new Set(rows)]}
function knownCharacterNameSet(p){return new Set(knownCharacterNames(p).map(normalizedName))}
function firstNameKey(value=''){return normalizedName(sanitizeCharacterIdentityName(value).split(/\s+/)[0]||'')}
function findExistingCharacterForName(name,p){
  const clean=sanitizeCharacterIdentityName(cleanCandidateName(name));const key=normalizedName(clean);if(!key)return null;
  const first=firstNameKey(clean);
  for(const c of p?.characters||[]){
    const identities=[c.name,...(c.aliases||[])].map(x=>sanitizeCharacterIdentityName(x)).filter(Boolean);
    for(const identity of identities){
      const ik=normalizedName(identity);if(!ik)continue;
      if(key===ik)return c;
      // A short first name (e.g. อนันต์) belongs to a stored full name (e.g. อนันต์ วงศ์สุริยัน).
      if(!clean.includes(' ')&&first&&first===firstNameKey(identity))return c;
      if(identity.includes(' ')&&ik.startsWith(key)&&first===firstNameKey(identity))return c;
    }
  }
  return null
}

const CANONICAL_CHARACTER_IDENTITIES=[
  {name:'อนันต์ วงศ์สุริยัน',aliases:['อนันต์','อนันต์วงศ์สุริยัน']},
  {name:'สม วงศ์สุริยัน',aliases:['สม','สมวงศ์สุริยัน']},
  {name:'เวหัสดิน อัครปักษา',aliases:['เวหัสดิน','เวหัสดินอัครปักษา','ชายปีกทอง']},
  {name:'สินธุ',aliases:['ลูกกิเลน']}
];
function canonicalIdentityForName(value=''){
  const clean=sanitizeCharacterIdentityName(repairThaiText(String(value||''))).trim();
  const key=normalizedName(clean);
  if(!key)return null;
  for(const row of CANONICAL_CHARACTER_IDENTITIES){
    const keys=[row.name,...row.aliases].map(normalizedName);
    if(keys.includes(key))return row;
    // Old versions sometimes appended sentence fragments to a valid identity.
    if(keys.some(k=>key.startsWith(k)&&key.length-k.length<=36))return row;
  }
  return null;
}
function enforceCanonicalCharacterIdentities(p){
  if(!p)return {merged:0,renamed:0,candidates:0};
  let merged=0,renamed=0,candidates=0;
  p.characters=p.characters||[];
  for(const identity of CANONICAL_CHARACTER_IDENTITIES){
    const matches=p.characters.filter(c=>canonicalIdentityForName(c.name)?.name===identity.name || (c.aliases||[]).some(a=>canonicalIdentityForName(a)?.name===identity.name));
    if(!matches.length)continue;
    matches.sort((a,b)=>characterRecordRichness(b)-characterRecordRichness(a));
    const target=matches[0];
    const oldName=target.name;
    for(const other of matches.slice(1)){mergeCharacterRecordInto(target,other);merged++}
    target.name=identity.name;
    target.aliases=uniqueTextValues([...(target.aliases||[]),oldName,...identity.aliases].filter(x=>normalizedName(x)!==normalizedName(identity.name)&&!looksLikeSentenceFragmentName(x)));
    target.updatedAt=now();
    if(normalizedName(oldName)!==normalizedName(identity.name))renamed++;
    const removeIds=new Set(matches.slice(1).map(x=>x.id));
    p.characters=p.characters.filter(c=>!removeIds.has(c.id));
  }
  const before=(p.characterCandidates||[]).length;
  p.characterCandidates=(p.characterCandidates||[]).filter(c=>!canonicalIdentityForName(c.name)&&!findExistingCharacterForName(c.name,p));
  candidates=before-p.characterCandidates.length;
  return {merged,renamed,candidates};
}

function uniqueTextValues(values){const seen=new Set(),out=[];for(const value of values||[]){const clean=repairThaiText(String(value||'')).replace(/\s+/g,' ').trim();const key=normalizedName(clean);if(clean&&!seen.has(key)){seen.add(key);out.push(clean)}}return out}
function looksLikeSentenceFragmentName(value=''){
  const n=repairThaiText(String(value||'')).replace(/\s+/g,' ').trim();
  return /(?:\s|^)(?:ก็|จึง|แล้ว|แต่|เป็นหนึ่ง|เป็นคน|ที่|ซึ่ง|ผู้|กำลัง|ยัง|ไม่|ได้|มี|คือ|เพราะ|ก่อน|หลัง)(?:\s|$)/.test(n)||/[.!?…:“”"']/.test(n)||n.split(/\s+/).length>3
}
function sanitizeCharacterIdentityName(value=''){
  let n=repairThaiText(String(value||'')).replace(/\s+/g,' ').trim();
  n=n.replace(/\s+(?:ก็|จึง|แล้ว|แต่|เป็นหนึ่ง|เป็นคน|ที่|ซึ่ง|กำลัง|ยัง|ไม่|ได้|มี|คือ|เพราะ|ก่อน|หลัง)\b.*$/u,'').trim();
  n=n.replace(/[.!?…:“”"'].*$/u,'').trim();
  return n
}
function characterRecordRichness(c){const n=sanitizeCharacterIdentityName(c.name||'');return (n.includes(' ')?30:0)+(c.autoExtracted?15:0)+Object.keys(c.structured||{}).length*3+String(c.facts||'').length/120+String(c.role||'').length/20-(looksLikeSentenceFragmentName(c.name||'')?80:0)}
function mergeCharacterRecordInto(target,source){
  const rawTarget=repairThaiText(target.name||'').trim(),rawSource=repairThaiText(source.name||'').trim();
  const targetName=sanitizeCharacterIdentityName(rawTarget),sourceName=sanitizeCharacterIdentityName(rawSource);
  const preferred=[targetName,sourceName].filter(Boolean).sort((a,b)=>{const ap=looksLikeSentenceFragmentName(a)?1:0,bp=looksLikeSentenceFragmentName(b)?1:0;if(ap!==bp)return ap-bp;const aw=a.split(/\s+/).length,bw=b.split(/\s+/).length;if(aw!==bw)return bw-aw;return b.length-a.length})[0]||targetName||sourceName;
  const aliases=[...(target.aliases||[]),...(source.aliases||[]),targetName,sourceName].filter(x=>x&&normalizedName(x)!==normalizedName(preferred)&&!looksLikeSentenceFragmentName(x));
  target.name=preferred;target.aliases=uniqueTextValues(aliases);
  target.status=target.status&&target.status!=='ไม่ทราบ'?target.status:(source.status||'ไม่ทราบ');
  target.role=target.role||source.role||'';target.facts=[target.facts,source.facts].filter(Boolean).join('\n');
  target.limits=[target.limits,source.limits].filter(Boolean).join('\n');target.structured={...(source.structured||{}),...(target.structured||{})};
  target.source=uniqueTextValues([target.source,source.source]).join(' | ');target.updatedAt=now();
  target.autoExtracted=target.autoExtracted||source.autoExtracted;target.autoExtractedFromNovel=target.autoExtractedFromNovel||source.autoExtractedFromNovel;
  return target
}
function charactersShareIdentity(a,b){
  const an=sanitizeCharacterIdentityName(a.name),bn=sanitizeCharacterIdentityName(b.name),ak=normalizedName(an),bk=normalizedName(bn);if(!ak||!bk)return false;
  const aset=new Set([an,...(a.aliases||[]).map(sanitizeCharacterIdentityName)].map(normalizedName).filter(Boolean));const bset=new Set([bn,...(b.aliases||[]).map(sanitizeCharacterIdentityName)].map(normalizedName).filter(Boolean));
  if([...aset].some(x=>bset.has(x)))return true;
  const short=ak.length<=bk.length?ak:bk,long=ak.length<=bk.length?bk:ak;
  if(long.startsWith(short)&&long.length-short.length>=2){
    const shortLabel=(ak.length<=bk.length?an:bn).trim(),longLabel=(ak.length<=bk.length?bn:an).trim();
    if(shortLabel.split(/\s+/).length===1)return true;
    if(longLabel.startsWith(shortLabel)&&looksLikeSentenceFragmentName((ak.length<=bk.length?b.name:a.name)||''))return true;
  }
  return false
}
function mergeDuplicateCharacters(p){
  const rows=[...(p.characters||[])],merged=[];let changed=0;
  for(const row of rows){let index=merged.findIndex(x=>charactersShareIdentity(x,row));if(index<0){merged.push(row);continue}
    const current=merged[index];const keep=characterRecordRichness(current)>=characterRecordRichness(row)?current:row;const drop=keep===current?row:current;mergeCharacterRecordInto(keep,drop);merged[index]=keep;changed++}
  p.characters=merged;return changed
}
function chapterPresenceForTerm(p,term){const ids=[];for(const ch of novelEntries(p)){if(countNameHits(ch.text||'',term).count)ids.push(ch.id)}return new Set(ids)}
function inferFullNamesFromNovel(p){
  let changed=0;const entries=novelEntries(p);
  for(const c of p.characters||[]){const base=repairThaiText(c.name||'').trim();if(!base||base.includes(' ')||base.length<2)continue;
    const escaped=base.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const counts=new Map();
    const re=new RegExp(`(^|[^ก-๙A-Za-z0-9_])(${escaped})\\s+([ก-ฮ][ก-์]{2,24})(?=$|[^ก-๙A-Za-z0-9_])`,'gu');
    for(const ch of entries){let m;const text=String(ch.text||'').normalize('NFC');while((m=re.exec(text))){const surname=m[3];if(CANDIDATE_STOP_WORDS.has(surname)||THAI_ACTION_SUFFIXES.some(v=>surname===v||surname.startsWith(v)))continue;const full=`${base} ${surname}`;counts.set(full,(counts.get(full)||0)+1)}}
    const best=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0];if(best&&best[1]>=1){const old=c.name;c.name=best[0];c.aliases=uniqueTextValues([...(c.aliases||[]),old]);c.updatedAt=now();changed++}
  }
  return changed
}
const DESCRIPTOR_HINTS=['ชายปีกทอง','หญิงปีกทอง','ลูกกิเลน','เด็กชายไร้นาม','เด็กหญิงไร้นาม','ฤๅษีเฒ่า','ชายชรา','หญิงชรา','เจ้าหญิง','เจ้าชาย','ผู้กองหญิง','ชายผมเงิน','หญิงผมเงิน'];
function descriptorLexemes(descriptor=''){
  const map={'ชายปีกทอง':['ชาย','ปีก','ทอง','ปักษา','ครุฑ'],'หญิงปีกทอง':['หญิง','ปีก','ทอง','ปักษา','ครุฑ'],'ลูกกิเลน':['ลูก','กิเลน'],'เด็กชายไร้นาม':['เด็กชาย','ไร้นาม'],'เด็กหญิงไร้นาม':['เด็กหญิง','ไร้นาม']};
  return map[descriptor]||descriptor.replace(/^(?:ชาย|หญิง|เด็กชาย|เด็กหญิง|ลูก|ท่าน|องค์)/,'').match(/[ก-ฮ]{2,}/g)||[]
}
function dialogueCoreferenceScore(descriptor,c,p){
  const names=characterAliasCandidates(c),entries=novelEntries(p);let score=0;
  for(const ch of entries){const text=String(ch.text||'').normalize('NFC');let pos=text.indexOf(descriptor);while(pos>=0){
    const left=Math.max(0,pos-500),right=Math.min(text.length,pos+descriptor.length+500),window=text.slice(left,right);
    for(const name of names){if(!name||name===descriptor)continue;const escName=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      if(new RegExp(`${escName}\\s*(?:กล่าว|ตอบ|ถาม|พูด|เอ่ย|ตะโกน|กระซิบ|ร้อง|พึมพำ)`).test(window))score+=55;
      if(new RegExp(`(?:กล่าว|ตอบ|ถาม|พูด|เอ่ย|ตะโกน|กระซิบ|ร้อง|พึมพำ)[^\\n]{0,120}${escName}`).test(window))score+=30;
      if(new RegExp(`[“\"‘'][^”\"’']{0,100}${escName}[^”\"’']{0,100}[”\"’']`).test(window))score+=45;
      const ni=window.indexOf(name);if(ni>=0){const distance=Math.abs((left+ni)-pos);if(distance<=120)score+=35;else if(distance<=260)score+=20;else score+=8}
    }
    pos=text.indexOf(descriptor,pos+descriptor.length)
  }}
  return score
}
function descriptorSimilarity(descriptor,c,p){
  const profile=repairThaiText([c.name,c.role,c.facts,Object.values(c.structured||{}).join(' ')].join(' '));let score=0;
  for(const term of descriptorLexemes(descriptor))if(term.length>1&&profile.includes(term))score+=term==='ชาย'||term==='หญิง'||term==='ลูก'?5:30;
  const dp=chapterPresenceForTerm(p,descriptor),names=characterAliasCandidates(c),cp=new Set();for(const name of names)for(const id of chapterPresenceForTerm(p,name))cp.add(id);
  const overlap=[...dp].filter(id=>cp.has(id)).length;if(dp.size)score+=Math.round(35*overlap/dp.size);
  score+=dialogueCoreferenceScore(descriptor,c,p);
  return score
}
function inferDescriptorAliases(p){
  let changed=0;const allText=novelEntries(p).map(x=>x.text||'').join('\n');
  const safeIdentityHints={
    'ชายปีกทอง':['เวหัสดิน'],
    'ลูกกิเลน':['สินธุ']
  };
  for(const descriptor of DESCRIPTOR_HINTS){
    if(!allText.includes(descriptor))continue;
    if(findExistingCharacterForName(descriptor,p))continue;
    let target=null;
    for(const hint of safeIdentityHints[descriptor]||[]){target=(p.characters||[]).find(c=>[c.name,...(c.aliases||[])].some(n=>firstNameKey(n)===normalizedName(hint)));if(target)break}
    if(!target){
      const ranked=(p.characters||[]).map(c=>({c,score:descriptorSimilarity(descriptor,c,p)})).sort((a,b)=>b.score-a.score);
      if(ranked[0]&&ranked[0].score>=70&&(!ranked[1]||ranked[0].score-ranked[1].score>=20))target=ranked[0].c;
    }
    if(target&&!target.aliases?.some(a=>normalizedName(a)===normalizedName(descriptor))){target.aliases=uniqueTextValues([...(target.aliases||[]),descriptor]);target.updatedAt=now();changed++}
  }
  return changed
}
function reconcileCharacterIdentity(p){for(const c of p.characters||[]){const clean=sanitizeCharacterIdentityName(c.name);if(clean&&clean!==c.name){c.aliases=uniqueTextValues([...(c.aliases||[]),c.name].filter(x=>!looksLikeSentenceFragmentName(x)));c.name=clean}}const forcedBefore=enforceCanonicalCharacterIdentities(p);const mergedBefore=mergeDuplicateCharacters(p);const full=inferFullNamesFromNovel(p);const descriptors=inferDescriptorAliases(p);const forcedAfter=enforceCanonicalCharacterIdentities(p);const mergedAfter=mergeDuplicateCharacters(p);return {merged:forcedBefore.merged+mergedBefore+forcedAfter.merged+mergedAfter,full:full+forcedBefore.renamed+forcedAfter.renamed,descriptors,candidates:forcedBefore.candidates+forcedAfter.candidates}}
function stripCandidateAction(value){let n=String(value||'').trim();let changed=true;while(changed){changed=false;for(const v of [...THAI_ACTION_SUFFIXES].sort((a,b)=>b.length-a.length)){if(n.endsWith(v)&&n.length>v.length+1){n=n.slice(0,-v.length).trim();changed=true;break}}}return n}
function cleanCandidateName(value){let n=repairExtractedThaiName(String(value||'')).replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/^[“”"'‘’\s—–-]+|[“”"'‘’.,!?…:;\s—–-]+$/g,'').replace(/\s+/g,' ').trim();n=stripCandidateAction(n);n=n.replace(/^(?:นาย|นาง|นางสาว|เด็กชาย|เด็กหญิง|เจ้าหญิง|เจ้าชาย|องค์|พญา|ฤๅษี|หลวงตา|ท่าน)\s*/,'').trim();return n}
function isKnownOrEmbeddedCharacter(name,p){const clean=cleanCandidateName(name),key=normalizedName(clean);if(!key)return true;if(findExistingCharacterForName(clean,p))return true;for(const known of knownCharacterNames(p)){const k=normalizedName(known);if(!k)continue;if(key===k)return true;if(key.startsWith(k)&&key.length-k.length<=12&&THAI_ACTION_SUFFIXES.some(v=>key===k+normalizedName(v)))return true;if(k.startsWith(key)&&k.length-key.length<=18)return true}return false}
function plausibleNovelCandidate(name){const n=cleanCandidateName(name),low=n.toLowerCase();if(!n||n.length<2||n.length>24)return false;if(DESCRIPTOR_HINTS.includes(n))return false;if(CANDIDATE_STOP_WORDS.has(n)||CANDIDATE_STOP_WORDS.has(low))return false;if(/\s{2,}|\d|[A-Za-z]{2,}|(?:บท|ตอน)ที่|DATABASE|CANON|ARC|PART|STATUS/i.test(n))return false;if(THAI_NON_NAME_PREFIXES.some(v=>n===v||n.startsWith(v)))return false;if(THAI_ACTION_SUFFIXES.some(v=>n===v))return false;if(/[!?…:;]|(?:ครับ|ค่ะ|คะ|นะ|สิ|เลย|แล้ว|ไม่)$/u.test(n))return false;if(/\s+(?:ประเมิน|ยัง|กำลัง|พูด|ตอบ|ถาม|เดิน|มอง|หยุด|ขยับ|เคลื่อนไหว|ลอย|พยายาม|หัน|ยืน|นั่ง|ก้ม|เงย|สั่ง|บอก)$/u.test(n))return false;if(/^(?:นักธนู|นักบวช|ซอมบี้|อันเดด|โกสต์|พระเอก|นางเอก|ชายผู้|หญิงผู้|ชายคน|หญิงคน)/u.test(n))return false;const thai=(n.match(/[ก-ฮ]/g)||[]).length;if(thai<2)return false;const words=n.split(/\s+/);if(words.length>3)return false;return true}
function boundaryCandidate(raw){let n=cleanCandidateName(raw);if(!n)return'';for(const knownAction of THAI_ACTION_SUFFIXES){const i=n.indexOf(knownAction);if(i>1){n=n.slice(0,i);break}}return cleanCandidateName(n)}
function addCandidateHit(map,name,chapter,text,index,verb,kind){name=boundaryCandidate(name);const key=normalizedName(name);if(!key)return;const row=map.get(key)||{id:uid(),name,chapterIds:new Set(),chapterTitles:new Set(),rawHits:0,verbs:new Set(),kinds:new Set(),contexts:[],confidence:0};row.chapterIds.add(chapter.id);row.chapterTitles.add(chapterDisplayTitle(chapter));row.rawHits++;if(verb)row.verbs.add(verb);if(kind)row.kinds.add(kind);if(row.contexts.length<3)row.contexts.push(text.slice(Math.max(0,index-70),Math.min(text.length,index+name.length+120)).replace(/\s+/g,' ').trim());map.set(key,row)}
function discoverCharacterCandidates(p){
  const ignored=new Set((p.ignoredCharacterNames||[]).map(normalizedName)),map=new Map();
  for(const chapter of novelEntries(p)){
    const text=String(chapter.text||'').normalize('NFC');
    // Strong evidence 1: dialogue attribution after a closing quotation mark.
    const dialogue=/[”"’']\s*([ก-ฮ][ก-์]*(?:\s+[ก-ฮ][ก-์]*){0,2})\s*(กล่าว|พูด|ถาม|ตอบ|ตะโกน|กระซิบ|เอ่ย|พึมพำ|ร้องเรียก|บอก|เตือน|สั่ง)/g;
    let m;while((m=dialogue.exec(text))){const name=boundaryCandidate(m[1]),key=normalizedName(name);if(plausibleNovelCandidate(name)&&!isKnownOrEmbeddedCharacter(name,p)&&!ignored.has(key))addCandidateHit(map,name,chapter,text,m.index,m[2],'dialogue')}
    // Strong evidence 2: sentence/paragraph beginning with a compact subject followed by a person action.
    const subject=/(?:^|[\n.!?…]|[”"’']\s+)([ก-ฮ][ก-์]*(?:\s+[ก-ฮ][ก-์]*){0,1})\s*(กล่าว|พูด|ถาม|ตอบ|ตะโกน|กระซิบ|เรียก|ร้อง|ยิ้ม|หัวเราะ|พยักหน้า|ส่ายหน้า|มอง|เดิน|วิ่ง|หัน|ลุก|นั่ง|ยืน|ถอนหายใจ|เอ่ย|ก้าว|ชะงัก|พึมพำ|บอก|เตือน|สั่ง|ก้ม|เงยหน้า|สะดุ้ง)/g;
    while((m=subject.exec(text))){const name=boundaryCandidate(m[1]),key=normalizedName(name);if(plausibleNovelCandidate(name)&&!isKnownOrEmbeddedCharacter(name,p)&&!ignored.has(key))addCandidateHit(map,name,chapter,text,m.index,m[2],'subject')}
    // Strong evidence 3: explicit named address inside dialogue, only when followed by punctuation.
    const vocative=/[“"‘'](?:[^”"’']{0,80}?)[,!…]\s*([ก-ฮ][ก-์]{1,15})(?=[!?,.…“"”'’])/g;
    while((m=vocative.exec(text))){const name=boundaryCandidate(m[1]),key=normalizedName(name);if(plausibleNovelCandidate(name)&&!isKnownOrEmbeddedCharacter(name,p)&&!ignored.has(key))addCandidateHit(map,name,chapter,text,m.index,'เรียกชื่อ','vocative')}
  }
  const out=[];
  for(const row of map.values()){
    row.chapterIds=[...row.chapterIds];row.chapterTitles=[...row.chapterTitles];row.verbs=[...row.verbs];row.kinds=[...row.kinds];
    let totalHits=0;for(const ch of novelEntries(p))totalHits+=countNameHits(ch.text||'',row.name).count;row.count=totalHits;
    const chapterScore=Math.min(24,row.chapterIds.length*8),hitScore=Math.min(20,row.rawHits*4),verbScore=Math.min(18,row.verbs.length*6),kindScore=Math.min(18,row.kinds.length*9);
    row.confidence=Math.min(99,Math.round(25+chapterScore+hitScore+verbScore+kindScore));
    // Precision-first gate: never show one-off fragments. Require repeated evidence across chapters,
    // or two independent evidence types with multiple action verbs.
    const strongAcrossChapters=row.chapterIds.length>=2&&row.rawHits>=3&&row.verbs.length>=2;
    const strongMixedEvidence=row.chapterIds.length>=2&&row.kinds.length>=2&&row.rawHits>=3;
    if((strongAcrossChapters||strongMixedEvidence)&&row.confidence>=86)out.push(row)
  }
  return out.sort((a,b)=>b.confidence-a.confidence||b.chapterIds.length-a.chapterIds.length||b.count-a.count).slice(0,12)
}
async function scanNovelCharacters(){if(!ensureProject())return;const p=project();p.characterCandidates=[];const reconciled=reconcileCharacterIdentity(p);const found=discoverCharacterCandidates(p).filter(c=>!canonicalIdentityForName(c.name)&&!findExistingCharacterForName(c.name,p)&&!DESCRIPTOR_HINTS.includes(c.name)&&!/^(?:ชายผู้|หญิงผู้|ชายคน|หญิงคน|หญิงสาวจาก|ชายจาก|หญิงจาก)/.test(c.name));p.characterCandidates=found;activity('character',`วิเคราะห์ตัวละครจากนิยาย: รวมซ้ำ ${reconciled.merged} · เติมชื่อเต็ม ${reconciled.full} · เชื่อมชื่อเรียก ${reconciled.descriptors} · ตัดรายการเดิม ${reconciled.candidates||0} · รอตรวจ ${found.length} (V42)`);await save();toast(`V42 จัดระเบียบแล้ว: รวม ${reconciled.merged} · ชื่อเต็ม ${reconciled.full} · ชื่อเรียก ${reconciled.descriptors} · รอตรวจ ${found.length}`)}
async function acceptCharacterCandidate(id){const p=project(),c=(p.characterCandidates||[]).find(x=>x.id===id);if(!c)return;if(!isKnownOrEmbeddedCharacter(c.name,p))p.characters.push({id:uid(),name:c.name,status:'ไม่ทราบ',role:'พบจากเนื้อหานิยาย',aliases:[],facts:`พบใน ${c.chapterTitles.length} ตอน รวม ${c.count} ครั้ง`,limits:'',structured:{'ปรากฏครั้งแรก':c.chapterTitles[0]||'','หลักฐานการสกัด':`${(c.kinds||[]).join(', ')} · กริยาที่พบ ${(c.verbs||[]).join(', ')}`},source:'สกัดจากเนื้อหานิยาย',autoExtractedFromNovel:true,updatedAt:now()});p.characterCandidates=p.characterCandidates.filter(x=>x.id!==id);await save();toast(`เพิ่ม ${c.name} เป็นตัวละครแล้ว`)}
async function ignoreCharacterCandidate(id){const p=project(),c=(p.characterCandidates||[]).find(x=>x.id===id);if(!c)return;p.ignoredCharacterNames=[...new Set([...(p.ignoredCharacterNames||[]),c.name])];p.characterCandidates=p.characterCandidates.filter(x=>x.id!==id);await save();toast(`ซ่อน ${c.name} แล้ว`)}
async function clearCharacterCandidates(saveAsIgnored=false){const p=project();if(!p)return;const items=p.characterCandidates||[];if(saveAsIgnored)p.ignoredCharacterNames=[...new Set([...(p.ignoredCharacterNames||[]),...items.map(x=>x.name)])];p.characterCandidates=[];await save();renderCharacterCandidates(p);toast(saveAsIgnored?'ปฏิเสธรายการรอตรวจทั้งหมดแล้ว':'ล้างรายการรอตรวจทั้งหมดแล้ว')}
function renderCharacterCandidates(p){const host=$('characterCandidateList'),count=$('characterCandidateCount');if(!host||!count)return;if(p?.characterCandidates){p.characterCandidates=p.characterCandidates.filter(c=>plausibleNovelCandidate(c.name)&&!isKnownOrEmbeddedCharacter(c.name,p)&&!canonicalIdentityForName(c.name));}const items=p?.characterCandidates||[];count.textContent=items.length?`${items.length} รายการรอตรวจ`:'ยังไม่มีรายการรอตรวจ';host.innerHTML=items.length?items.map(c=>`<article class="candidate-card"><div class="candidate-main"><div class="candidate-title"><strong>${esc(c.name)}</strong><span class="confidence-badge">${c.confidence}%</span></div><p>พบ ${c.count} ครั้ง ใน ${c.chapterTitles.length} ตอน · หลักฐาน ${(c.kinds||[]).map(x=>x==='dialogue'?'บทพูด':x==='subject'?'ประธานประโยค':'การเรียกชื่อ').join(' + ')}</p><div class="candidate-chapters">${c.chapterTitles.slice(0,4).map(t=>`<span>${esc(t)}</span>`).join('')}</div>${c.contexts[0]?`<blockquote>${esc(c.contexts[0])}</blockquote>`:''}</div><div class="candidate-actions"><button class="primary" data-candidate-accept="${c.id}">เพิ่มเป็นตัวละคร</button><button class="danger outline" data-candidate-ignore="${c.id}">ไม่ใช่ตัวละคร</button></div></article>`).join(''):'<div class="empty compact">กด “วิเคราะห์จากนิยาย” ระบบจะแสดงไม่เกิน 12 ชื่อใหม่ที่มีหลักฐานหลายชนิดและพบซ้ำหลายตอน</div>';document.querySelectorAll('[data-candidate-accept]').forEach(b=>b.onclick=()=>acceptCharacterCandidate(b.dataset.candidateAccept));document.querySelectorAll('[data-candidate-ignore]').forEach(b=>b.onclick=()=>ignoreCharacterCandidate(b.dataset.candidateIgnore));const clear=$('clearCharacterCandidatesBtn'),reject=$('rejectAllCharacterCandidatesBtn');if(clear)clear.onclick=()=>clearCharacterCandidates(false);if(reject)reject.onclick=()=>clearCharacterCandidates(true)}

function canonModal(item=null){if(!ensureProject())return;openModal(item?'แก้ไข Canon':'เพิ่ม Canon',`<div class="form-grid"><div class="row2"><input id="mCanonTitle" placeholder="หัวข้อ"><select id="mCanonCategory"><option>ตัวละคร</option><option>ระบบ</option><option>พลัง</option><option>ไทม์ไลน์</option><option>สถานที่</option><option>ไอเทม</option><option>กฎโลก</option><option>อื่น ๆ</option></select></div><textarea id="mCanonRule" placeholder="ข้อความ Canon ที่ล็อกไว้"></textarea><textarea id="mCanonSource" placeholder="แหล่งอ้างอิง เช่น ชื่อไฟล์ > หัวข้อ > หน้า"></textarea><div class="row2"><select id="mCanonPriority"><option value="100">ผู้ใช้ล็อกเอง — สูงสุด</option><option value="80">Canon Database</option><option value="70">Character Bible</option><option value="60">Timeline</option><option value="40">ต้นฉบับตอน</option><option value="20">เอกสารอ้างอิง</option></select><button id="mSaveCanon" class="primary">บันทึก Canon</button></div></div>`,()=>{if(item){$('mCanonTitle').value=item.title;$('mCanonCategory').value=item.category;$('mCanonRule').value=item.rule;$('mCanonSource').value=item.source;$('mCanonPriority').value=String(item.priority||100)}$('mSaveCanon').onclick=async()=>{const rule=$('mCanonRule').value.trim();if(!rule)return toast('กรุณาใส่ข้อความ Canon');const p=project();const data={id:item?.id||uid(),title:$('mCanonTitle').value.trim()||'ไม่ระบุหัวข้อ',category:$('mCanonCategory').value,rule,source:$('mCanonSource').value.trim(),priority:Number($('mCanonPriority').value),locked:true,updatedAt:now()};if(item)Object.assign(p.canon.find(x=>x.id===item.id),data);else p.canon.push(data);activity('canon',`${item?'แก้ไข':'เพิ่ม'} Canon: ${data.title}`);closeModal();await save();toast('บันทึก Canon แล้ว')}})}

function characterModal(item=null){if(!ensureProject())return;openModal(item?'แก้ไขตัวละคร':'เพิ่มตัวละคร',`<div class="form-grid"><div class="row2"><input id="mCharName" placeholder="ชื่อตัวละคร"><select id="mCharStatus"><option>มีชีวิต</option><option>เสียชีวิต</option><option>สูญหาย</option><option>ไม่ทราบ</option></select></div><div class="row2"><input id="mCharRole" placeholder="บทบาท"><input id="mCharAliases" placeholder="ชื่อเรียกอื่น คั่นด้วยจุลภาค"></div><textarea id="mCharFacts" placeholder="ข้อเท็จจริงสำคัญ รูปลักษณ์ พลัง สิ่งที่รู้"></textarea><textarea id="mCharLimits" placeholder="ข้อจำกัดหรือสิ่งที่ห้ามขัด"></textarea><input id="mCharSource" placeholder="แหล่งอ้างอิง"><button id="mSaveChar" class="primary">บันทึกตัวละคร</button></div>`,()=>{if(item){$('mCharName').value=item.name;$('mCharStatus').value=item.status;$('mCharRole').value=item.role||'';$('mCharAliases').value=(item.aliases||[]).join(', ');$('mCharFacts').value=item.facts||'';$('mCharLimits').value=item.limits||'';$('mCharSource').value=item.source||''}$('mSaveChar').onclick=async()=>{const name=$('mCharName').value.trim();if(!name)return toast('กรุณาใส่ชื่อตัวละคร');const p=project();const data={id:item?.id||uid(),name,status:$('mCharStatus').value,role:$('mCharRole').value.trim(),aliases:$('mCharAliases').value.split(',').map(x=>x.trim()).filter(Boolean),facts:$('mCharFacts').value.trim(),limits:$('mCharLimits').value.trim(),source:$('mCharSource').value.trim(),updatedAt:now()};if(item)Object.assign(p.characters.find(x=>x.id===item.id),data);else p.characters.push(data);activity('character',`${item?'แก้ไข':'เพิ่ม'}ตัวละคร ${name}`);closeModal();await save();toast('บันทึกตัวละครแล้ว')}})}

function timelineModal(item=null){if(!ensureProject())return;openModal(item?'แก้ไขเหตุการณ์':'เพิ่มเหตุการณ์',`<div class="form-grid"><div class="row2"><input id="mTimeLabel" placeholder="เวลา เช่น Day 0 / 12 มี.ค."><input id="mTimeChapter" placeholder="ตอนที่ เช่น 31"></div><input id="mTimeTitle" placeholder="ชื่อเหตุการณ์"><textarea id="mTimeDetails" placeholder="รายละเอียด"></textarea><input id="mTimeSource" placeholder="แหล่งอ้างอิง"><button id="mSaveTime" class="primary">บันทึกเหตุการณ์</button></div>`,()=>{if(item){$('mTimeLabel').value=item.label||'';$('mTimeChapter').value=item.chapter||'';$('mTimeTitle').value=item.title;$('mTimeDetails').value=item.details||'';$('mTimeSource').value=item.source||''}$('mSaveTime').onclick=async()=>{const title=$('mTimeTitle').value.trim();if(!title)return toast('กรุณาใส่ชื่อเหตุการณ์');const p=project();const data={id:item?.id||uid(),label:$('mTimeLabel').value.trim(),chapter:$('mTimeChapter').value.trim(),title,details:$('mTimeDetails').value.trim(),source:$('mTimeSource').value.trim(),order:Number($('mTimeChapter').value)||999999,updatedAt:now()};if(item)Object.assign(p.timeline.find(x=>x.id===item.id),data);else p.timeline.push(data);activity('timeline',`${item?'แก้ไข':'เพิ่ม'} Timeline: ${title}`);closeModal();await save();toast('บันทึก Timeline แล้ว')}})}

function textStats(text){const clean=text.trim();return {chars:clean.length,words:(clean.match(/[\p{L}\p{N}]+/gu)||[]).length,paras:clean?clean.split(/\n\s*\n/).filter(x=>x.trim()).length:0,dialogues:(clean.match(/[“”"].+?[“”"]/g)||[]).length,sentences:(clean.split(/[.!?…]|[。！？]/).filter(x=>x.trim()).length)}}
function updateEditorStats(){const s=textStats($('chapterText').value);$('wordStats').textContent=`${s.chars.toLocaleString('th-TH')} ตัวอักษร · ${s.words.toLocaleString('th-TH')} คำ · ${s.paras} ย่อหน้า`}
function autosaveDraft(){clearTimeout(saveTimer);$('autosaveState').textContent='มีการแก้ไข';saveTimer=setTimeout(async()=>{if(!project())return;localStorage.setItem(`novel-draft-${project().id}`,JSON.stringify({id:currentChapterId,source:currentChapterSource,title:$('chapterTitle').value,text:$('chapterText').value,at:now()}));$('autosaveState').textContent='บันทึกร่างอัตโนมัติแล้ว'},650)}
function loadChapter(ch,source='manual'){currentChapterId=ch.id;currentChapterSource=source;$('chapterTitle').value=chapterDisplayTitle(ch);$('chapterText').value=ch.text||'';updateEditorStats();$('autosaveState').textContent=`${source==='imported'?'ต้นฉบับนำเข้า · ':''}บันทึกล่าสุด ${new Date(ch.updatedAt||ch.createdAt).toLocaleString('th-TH')}`;switchView('editor')}

function snippets(text,term,limit=2){const out=[];let start=0;const low=text.toLowerCase(),q=term.toLowerCase();while(out.length<limit){const i=low.indexOf(q,start);if(i<0)break;out.push(text.slice(Math.max(0,i-70),Math.min(text.length,i+term.length+100)).replace(/\s+/g,' '));start=i+q.length}return out}
function checkChapter(text,p){const issues=[];const lower=text.toLowerCase();
  for(const c of [...p.canon].sort((a,b)=>(b.priority||0)-(a.priority||0))){const title=(c.title||'').trim();const terms=[title,...(c.rule.match(/[\p{L}\p{N}_-]{4,}/gu)||[])].filter(Boolean);const relevant=[...new Set(terms)].filter(t=>lower.includes(t.toLowerCase())).slice(0,5);if(!relevant.length)continue;const restrictive=/ห้าม|เฉพาะ|เท่านั้น|ไม่สามารถ|ต้องไม่|ยังไม่มี|เสียชีวิต|ตายแล้ว|ไม่รู้|มองไม่เห็น|ไม่ได้ยิน/.test(c.rule);if(restrictive)issues.push({severity:'medium',type:'Canon',title:`ควรตรวจบริบทกับ Canon: ${c.title}`,excerpt:snippets(text,relevant[0],1)[0]||relevant.join(', '),evidence:c.rule,source:c.source||'Canon ที่ล็อก',suggestion:'อ่านบริบทและยืนยันว่าบทใหม่ไม่ละเมิดข้อจำกัดนี้'})}
  for(const ch of p.characters){const names=[ch.name,...(ch.aliases||[])].filter(Boolean);const found=names.find(n=>lower.includes(n.toLowerCase()));if(!found)continue;if(ch.status==='เสียชีวิต')issues.push({severity:'high',type:'ตัวละคร',title:`${ch.name} ถูกระบุว่าเสียชีวิต แต่ปรากฏในบท`,excerpt:snippets(text,found,1)[0]||found,evidence:`สถานะตัวละคร: ${ch.status}`,source:ch.source||'Character Database',suggestion:'ตรวจว่าเป็นฉากย้อนอดีต ความทรงจำ วิญญาณ หรือเป็นความขัดแย้งจริง'});if(ch.limits)issues.push({severity:'medium',type:'ตัวละคร',title:`ตรวจข้อจำกัดของ ${ch.name}`,excerpt:snippets(text,found,1)[0]||found,evidence:ch.limits,source:ch.source||'Character Database',suggestion:'เปรียบเทียบการกระทำและความรู้ของตัวละครกับข้อจำกัดที่ล็อกไว้'})}
  const paras=text.split(/\n\s*\n/).map(x=>x.trim()).filter(x=>x.length>50);const map=new Map();for(const para of paras){const k=para.replace(/\s+/g,' ').toLowerCase();map.set(k,(map.get(k)||0)+1)}for(const [para,count] of map)if(count>1)issues.push({severity:'medium',type:'ข้อความซ้ำ',title:'พบย่อหน้าซ้ำตรงกัน',excerpt:para.slice(0,230),evidence:`พบ ${count} ครั้ง`,source:'บทปัจจุบัน',suggestion:'ตัดหรือปรับย่อหน้าที่ซ้ำ'})
  const repeated=[];for(let i=1;i<paras.length;i++){const a=new Set(paras[i-1].split(/\s+/)),b=new Set(paras[i].split(/\s+/));const inter=[...a].filter(x=>b.has(x)&&x.length>3).length;const ratio=inter/Math.max(1,Math.min(a.size,b.size));if(ratio>.72)repeated.push(i)}if(repeated.length)issues.push({severity:'medium',type:'ความซ้ำ',title:'ย่อหน้าติดกันมีเนื้อหาใกล้เคียงกันมาก',excerpt:`ตำแหน่งย่อหน้า: ${repeated.map(x=>x+1).join(', ')}`,evidence:'วัดจากคำร่วมกันมากกว่า 72%',source:'บทปัจจุบัน',suggestion:'ตรวจว่ากำลังอธิบายประเด็นเดิมซ้ำหรือไม่'})
  if(!issues.length)issues.push({severity:'low',type:'ผลตรวจ',title:'ยังไม่พบจุดผิดปกติจากกฎออฟไลน์',excerpt:'',evidence:'ระบบตรวจไม่พบรูปแบบที่ตรงกับกฎที่ตั้งไว้',source:'Novel Studio V1',suggestion:'ผลนี้ไม่ใช่การยืนยันว่าไม่มีความขัดแย้งเชิงความหมายทั้งหมด'});
  return issues;
}

function analyzeDNA(){if(!ensureProject())return;const p=project();const texts=[...p.documents.filter(d=>d.type==='chapter').map(d=>d.text),...p.chapters.map(c=>c.text)].filter(Boolean);if(!texts.length)return toast('ยังไม่มีต้นฉบับสำหรับวิเคราะห์');const text=texts.join('\n\n');const s=textStats(text);const paras=text.split(/\n\s*\n/).filter(x=>x.trim());const words=(text.toLowerCase().match(/[\p{L}]{2,}/gu)||[]).filter(w=>!['และ','ของ','ที่','ใน','เป็น','ก็','ไม่','แต่','แล้ว','กับ','ให้','ได้','จาก','เขา','เธอ','มัน','ว่า','เมื่อ','ยัง','อย่าง','หรือ','ซึ่ง','นั้น','นี้','ขึ้น','ลง','ไป','มา'].includes(w));const freq={};words.forEach(w=>freq[w]=(freq[w]||0)+1);const top=Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,24);const quoteChars=(text.match(/[“"]/g)||[]).length;const avgPara=paras.length?Math.round(text.length/paras.length):0;p.dna={...s,documents:texts.length,avgParagraphChars:avgPara,dialogueSignal:Math.min(100,Math.round(quoteChars/Math.max(1,text.length)*1000)),top,analyzedAt:now()};activity('dna','วิเคราะห์ Writing DNA');save();toast('วิเคราะห์ Writing DNA แล้ว')}

function renderAll(){renderProjectSelect();const p=project();$('heroProject').textContent=p?.name||'ยังไม่มีโปรเจกต์';renderDashboard(p);renderDocuments(p);renderNovelContent(p);renderCanon(p);renderCharacters(p);if(currentCharacterId)renderCharacterDetail(p?.characters.find(x=>x.id===currentCharacterId));if(currentNovelDocumentId)renderNovelReader(resolveNovelEntry(p,currentNovelDocumentId));renderTimeline(p);renderChapters(p);renderIssues(p);renderDNA(p)}
function renderProjectSelect(){const sel=$('activeProjectSelect');sel.innerHTML=state.projects.length?state.projects.map(p=>`<option value="${p.id}" ${p.id===state.activeProjectId?'selected':''}>${esc(p.name)}</option>`).join(''):'<option value="">ยังไม่มีโปรเจกต์</option>'}
function normalizedChapterIdentity(title=''){return thaiDigitsToArabic(String(title)).toLowerCase().replace(/\s+/g,' ').replace(/[\[\](){}]/g,'').trim()}
function actualChapterCount(p){const titles=new Set();derivedChapters(p).forEach(d=>titles.add(normalizedChapterIdentity(chapterDisplayTitle(d))||d.id));(p?.chapters||[]).forEach(c=>titles.add(normalizedChapterIdentity(c.title)||c.id));return titles.size}
function renderDashboard(p){const sourceCount=sourceDocuments(p).length;const data=[['เอกสาร',sourceCount],['Canon',p?.canon.length||0],['ตัวละคร',p?.characters.length||0],['ตอน',actualChapterCount(p),'chapters']];$('stats').innerHTML=data.map(([n,v,key])=>`<div class="stat"${key?` data-stat="${key}"`:''}><strong>${v.toLocaleString('th-TH')}</strong><span>${n}</span></div>`).join('');const chapterStat=document.querySelector('[data-stat="chapters"]');if(chapterStat)chapterStat.onclick=()=>switchView('novelContent');$('recentActivity').innerHTML=p?.activity.length?p.activity.slice(0,7).map(a=>`<div class="list-row"><div class="grow"><strong>${esc(a.text)}</strong><p>${new Date(a.at).toLocaleString('th-TH')}</p></div></div>`).join(''):'<div class="empty">ยังไม่มีกิจกรรม</div>';$('healthList').innerHTML=[['เอกสารฐานข้อมูล',sourceCount?'พร้อม':'ยังไม่มี'],['Canon ที่ล็อก',p?.canon.length?`${p.canon.length} รายการ`:'ยังไม่มี'],['ข้อมูลตัวละคร',p?.characters.length?`${p.characters.length} คน`:'ยังไม่มี'],['บท/ตอนที่ใช้งาน',actualChapterCount(p)?`${actualChapterCount(p)} ตอน`:'ยังไม่มี']].map(([a,b])=>`<div class="health"><strong>${a}</strong><span>${b}</span></div>`).join('')}
const DOCUMENT_TYPE_LABELS={canon:'Canon Database',timeline:'Timeline',character:'Character Bible',chapter:'ต้นฉบับตอน',reference:'เอกสารอ้างอิง'};
function documentTypeLabel(type){return DOCUMENT_TYPE_LABELS[type]||type||'เอกสาร'}
function renderDocuments(p){
  const q=$('documentSearch').value.trim().toLowerCase(),selectedType=$('documentType').value;
  const docs=sourceDocuments(p,selectedType).filter(d=>!q||String(d.name||'').toLowerCase().includes(q)||String(d.text||'').toLowerCase().includes(q));
  $('documentList').innerHTML=docs.length?docs.map(d=>{
    const childCount=(p.documents||[]).filter(x=>x.sourceDocumentId===d.id&&x.derivedChapter).length;
    return `<article class="item-card"><div><span class="badge">${esc(documentTypeLabel(d.type))}</span></div><h3>${esc(d.name)}</h3><div class="meta">${(d.text?.length||0).toLocaleString('th-TH')} ตัวอักษร${d.pageCount?` · ${d.pageCount} หน้า`:''}${childCount?` · แยกแล้ว ${childCount} บท/ตอน`:''} · ${new Date(d.updatedAt||d.createdAt).toLocaleString('th-TH')}</div><details><summary>ดูข้อความที่อ่านได้</summary><pre>${esc((d.text||'').slice(0,14000))}${d.text?.length>14000?'\n…ตัดการแสดงผล':''}</pre></details><div class="card-actions"><button data-doc-delete="${d.id}" class="danger outline">ลบไฟล์นี้</button></div></article>`
  }).join(''):`<div class="empty">ยังไม่มีเอกสารประเภท “${esc(documentTypeLabel(selectedType))}”</div>`;
  document.querySelectorAll('[data-doc-delete]').forEach(b=>b.onclick=async()=>{if(confirm('ลบไฟล์นี้และข้อมูลที่สกัดจากไฟล์นี้ทั้งหมดหรือไม่?')){const doc=p.documents.find(x=>x.id===b.dataset.docDelete);p.documents=p.documents.filter(x=>x.id!==b.dataset.docDelete&&x.sourceDocumentId!==b.dataset.docDelete);if(doc?.sourceKey)p.documents=p.documents.filter(x=>x.sourceKey!==doc.sourceKey);await save()}})
}

function chapterSortNumber(doc){if(Number.isFinite(Number(doc?.chapterNumber)))return Number(doc.chapterNumber);const name=thaiDigitsToArabic(doc?.title||doc?.name||'');const m=name.match(/(?:บท|ตอน|chapter|ep(?:isode)?)[^0-9]{0,8}(\d+)/i)||name.match(/(?:^|[^0-9])(\d{1,4})(?:[^0-9]|$)/);return m?Number(m[1]):999999}
function cleanNovelText(text){return repairThaiText(cleanPdfGlyphs(String(text||''))).replace(/[▤▥▦▧▨▩▣▰▱]/g,'').replace(/[ \t]+/g,' ').replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim()}
function chapterDisplayTitle(doc){
  if(doc?.title)return String(doc.title);
  let raw=String(doc?.name||'').replace(/\.(pdf|docx|txt|md)$/i,'').replace(/^\s*\[?rewrite\]?\s*/i,'').replace(/\s*\(\d+\)\s*$/,'').trim();
  raw=repairThaiText(raw);
  const m=raw.match(/((?:บท|ตอน)ที่)\s*([๐-๙0-9]+)\s*[:：\-–—]?\s*(.*)$/i);
  if(m)return `${m[1]} ${m[2]} : ${m[3].trim()||'ไม่มีชื่อ'}`;
  const n=chapterSortNumber(doc);return n<999999?`บทที่ ${n} : ${raw}`:raw;
}
function novelExcerpt(text){return cleanNovelText(String(text||'').replace(/\[หน้า\s*\d+\]/g,' ')).replace(/\s+/g,' ').slice(0,180)}
function unifiedChapterEntries(p){
  const imported=derivedChapters(p).map(d=>({...d,entryKey:`doc:${d.id}`,entrySource:'imported'}));
  const manual=(p?.chapters||[]).map(c=>({...c,name:c.title,type:'chapter',entryKey:`manual:${c.id}`,entrySource:'manual',chapterNumber:chapterSortNumber(c)}));
  const byIdentity=new Map();
  [...imported,...manual].forEach(item=>{
    const key=normalizedChapterIdentity(chapterDisplayTitle(item))||item.entryKey;
    const old=byIdentity.get(key);
    if(!old||String(item.updatedAt||'')>String(old.updatedAt||''))byIdentity.set(key,item);
  });
  return [...byIdentity.values()];
}
function resolveNovelEntry(p,key){
  if(!key)return null;
  const [kind,id]=String(key).includes(':')?String(key).split(/:(.+)/):['doc',key];
  if(kind==='manual'){
    const c=(p?.chapters||[]).find(x=>x.id===id);
    return c?{...c,name:c.title,type:'chapter',entryKey:key,entrySource:'manual'}:null;
  }
  const d=(p?.documents||[]).find(x=>x.id===id);
  return d?{...d,entryKey:`doc:${d.id}`,entrySource:'imported'}:null;
}
function renderNovelContent(p){
  const q=String($('novelSearch')?.value||'').trim().toLowerCase();
  const docs=unifiedChapterEntries(p).filter(d=>!q||String(d.name||d.title||'').toLowerCase().includes(q)||String(d.text||'').toLowerCase().includes(q)).sort((a,b)=>chapterSortNumber(a)-chapterSortNumber(b)||String(a.name||a.title).localeCompare(String(b.name||b.title),'th'));
  if($('novelCount'))$('novelCount').textContent=`${docs.length.toLocaleString('th-TH')} บท/ตอน`;
  $('novelChapterList').innerHTML=docs.length?docs.map((d,i)=>`<article class="novel-chapter-card" data-novel-doc="${esc(d.entryKey)}" tabindex="0"><div class="novel-chapter-number">${chapterSortNumber(d)<999999?chapterSortNumber(d):i+1}</div><div class="novel-chapter-main"><span class="badge">${d.entrySource==='manual'?'เขียนในแอป':'ต้นฉบับนำเข้า'}</span><h3>${esc(chapterDisplayTitle(d))}</h3><p>${esc(novelExcerpt(d.text)||'ไม่มีข้อความที่อ่านได้')}</p><div class="meta">${(d.text?.length||0).toLocaleString('th-TH')} ตัวอักษร${d.pageCount?` · ${d.pageCount} หน้า`:''}</div></div><button class="view-novel-btn" data-open-novel="${esc(d.entryKey)}">อ่าน</button></article>`).join(''):'<div class="empty">ยังไม่มีต้นฉบับตอน สามารถนำเข้าไฟล์หรือเขียนตอนใหม่ได้จากหน้าเขียนบท</div>';
  document.querySelectorAll('[data-open-novel]').forEach(b=>b.onclick=e=>{e.stopPropagation();openNovelReader(b.dataset.openNovel)});
  document.querySelectorAll('[data-novel-doc]').forEach(card=>{card.onclick=()=>openNovelReader(card.dataset.novelDoc);card.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openNovelReader(card.dataset.novelDoc)}}})
}
async function renderPdfOriginal(doc, token){
  const host=$('novelReaderBody');
  host.innerHTML='<div class="pdf-native-loading">กำลังเปิดต้นฉบับ PDF…</div>';
  try{
    if(activePdfObjectUrl){URL.revokeObjectURL(activePdfObjectUrl);activePdfObjectUrl=null}
    const bytes=base64ToBytes(doc.pdfBase64);
    const blob=new Blob([bytes],{type:'application/pdf'});
    activePdfObjectUrl=URL.createObjectURL(blob);
    if(token!==novelRenderToken)return;

    host.innerHTML=`<section class="pdf-native-shell">
      <div class="pdf-native-toolbar">
        <span>แสดงต้นฉบับ PDF โดยตรง เพื่อรักษาวรรณยุกต์และรูปแบบหน้า</span>
        <a class="pdf-native-open" id="openNativePdf" target="_blank" rel="noopener">เปิดเต็มหน้าจอ</a>
      </div>
      <iframe id="nativePdfFrame" class="pdf-native-frame" title="ต้นฉบับ PDF" loading="eager"></iframe>
      <div class="pdf-native-fallback" id="pdfNativeFallback" hidden>
        Safari ไม่อนุญาตให้ฝัง PDF ในหน้านี้ กรุณากด “เปิดเต็มหน้าจอ”
      </div>
    </section>`;
    const frame=$('nativePdfFrame');
    const open=$('openNativePdf');
    open.href=activePdfObjectUrl;
    frame.src=activePdfObjectUrl+'#toolbar=0&navpanes=0&view=FitH';
    const fallbackTimer=setTimeout(()=>{
      if(token===novelRenderToken && (!frame.contentWindow || frame.clientHeight<100)) $('pdfNativeFallback').hidden=false;
    },1800);
    frame.onload=()=>clearTimeout(fallbackTimer);
  }catch(err){
    if(token!==novelRenderToken)return;
    host.innerHTML=`<div class="empty">เปิดต้นฉบับ PDF ไม่สำเร็จ: ${esc(err?.message||'ข้อผิดพลาดไม่ทราบสาเหตุ')}</div>`;
  }
}
async function renderNovelReader(doc){
  const token=++novelRenderToken;
  if(!doc){$('novelReaderTitle').textContent='ไม่พบต้นฉบับ';$('novelReaderMeta').textContent='';$('novelReaderBody').innerHTML='<div class="empty">ไฟล์นี้อาจถูกลบแล้ว</div>';return}
  $('novelReaderType').textContent=documentTypeLabel(doc.type);
  $('novelReaderTitle').textContent=chapterDisplayTitle(doc);
  $('novelReaderMeta').textContent=`${(doc.text?.length||0).toLocaleString('th-TH')} ตัวอักษร${doc.pageCount?` · ${doc.pageCount} หน้า`:''} · นำเข้า ${new Date(doc.createdAt).toLocaleString('th-TH')}`;
  if(doc.pdfBase64){await renderPdfOriginal(doc,token);return}
  const raw=cleanNovelText(doc.text||'');
  if(!raw){$('novelReaderBody').innerHTML='<div class="empty">ไม่พบข้อความที่อ่านได้จากไฟล์นี้</div>';return}
  const body=raw.replace(/^\[หน้า\s*\d+\]\s*/,'').replace(/\n\n\[หน้า\s*\d+\]\s*/g,'\n\n');
  const blocks=body.split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean);
  $('novelReaderBody').innerHTML=`<article class="novel-reading-sheet no-copy"><div class="novel-reading-prose">${blocks.map((block)=>{
    if(/^━━━━━━━━/.test(block))return '<div class="scene-divider">◆ ◆ ◆</div>';
    if(/^(?:บท|ตอน)ที่\s*[๐-๙0-9]+\s*[:：]/.test(block))return `<h2>${esc(block)}</h2>`;
    if(block.length<100&&!/[.!?…ฯ]$/.test(block)&&/^(?:หลายวันก่อนหน้านั้น|อำเภอ|จังหวัด|ตลาด|เส้นทาง|ลำห้วย)/.test(block))return `<h3>${esc(block)}</h3>`;
    return `<p>${esc(block)}</p>`;
  }).join('')}</div></article>`;
}
function openNovelReader(key){currentNovelDocumentId=key;switchView('novelReader');renderNovelReader(resolveNovelEntry(project(),key))}
function renderCanon(p){
  const q=$('canonSearch').value.trim().toLowerCase(),f=$('canonFilter').value;
  const items=(p?.canon||[]).filter(c=>(!f||c.category===f)&&(!q||`${c.title} ${c.rule} ${c.source}`.toLowerCase().includes(q)));
  const bySource={};for(const c of items){const k=c.source||'เพิ่มด้วยตนเอง';(bySource[k]||(bySource[k]=[])).push(c)}
  $('canonList').innerHTML=items.length?Object.entries(bySource).map(([source,rows])=>`<section class="canon-source-group"><div class="canon-source-head"><div><span class="badge">${rows[0].autoExtracted?'เชื่อมจากคลังเอกสาร':'เพิ่มด้วยตนเอง'}</span><h3>${esc(source)}</h3><p>${rows.length} หัวข้อ Canon</p></div>${rows[0].sourceDocumentId?`<button data-canon-source="${esc(source)}">เปิดไฟล์ต้นทาง</button>`:''}</div><div class="canon-topic-list">${rows.map(c=>`<article class="item-card canon-topic-card"><div class="canon-topic-title"><span class="badge">${esc(c.category)}</span>${c.autoExtracted?'<span class="subtle-tag">สกัดอัตโนมัติ</span>':''}</div><h3>${esc(c.title)}</h3><p>${esc(c.rule)}</p><div class="meta">ลำดับความสำคัญ ${c.priority||100} · ${esc(c.source||'ไม่มีแหล่งอ้างอิง')}</div><div class="card-actions"><button data-canon-edit="${c.id}">แก้ไข</button><button data-canon-delete="${c.id}" class="danger outline">ลบ</button></div></article>`).join('')}</div></section>`).join(''):'<div class="empty">ยังไม่มี Canon ที่ล็อก — นำเข้าไฟล์ Canon Database ในคลังเอกสาร ระบบจะแยกตามหัวข้อให้อัตโนมัติ</div>';
  document.querySelectorAll('[data-canon-edit]').forEach(b=>b.onclick=()=>canonModal(p.canon.find(x=>x.id===b.dataset.canonEdit)));
  document.querySelectorAll('[data-canon-delete]').forEach(b=>b.onclick=async()=>{if(confirm('ลบ Canon นี้หรือไม่?')){p.canon=p.canon.filter(x=>x.id!==b.dataset.canonDelete);await save()}});
  document.querySelectorAll('[data-canon-source]').forEach(b=>b.onclick=()=>focusSourceDocument(b.dataset.canonSource));
}

function normalizeComparableText(value){return repairThaiText(String(value||'')).toLowerCase().replace(/[\s\n\r.,;:!?"“”'‘’()\[\]{}|/\\–—_-]+/g,'')}
function splitCharacterItems(value){
  let text=repairThaiText(value).replace(/\s*\|\s*/g,'\n').replace(/\s*[•●▪]\s*/g,'\n• ');
  text=text.replace(/\s+(?=(?:บิดา|มารดา|พี่น้อง|ฐานะครอบครัว|เรื่องต้นทาง|สถานะปลายเรื่อง|สถานะหลังจบเรื่อง|เหตุการณ์สำคัญหลังจบเรื่อง|บทบาทในม่านภพ|บทบาท|เผ่าพันธุ์|อายุ|วิถีหลัก|พรสวรรค์|บ้านเกิด|บ้านปัจจุบัน)\s*[:：])/g,'\n');
  text=text.replace(/\s+↓\s+/g,'\n↓ ');
  return text.split(/\n+/).map(x=>x.replace(/^[-•●▪]\s*/,'').trim()).filter(Boolean);
}
function dedupeCharacterText(value){
  const seen=new Set(),out=[];
  for(const item of splitCharacterItems(value)){
    const key=normalizeComparableText(item);
    if(!key||key.length<2||seen.has(key))continue;
    // Drop a shorter duplicate when the same fact is already present in a fuller sentence.
    if(out.some(x=>{const k=normalizeComparableText(x);return key.length>12&&(k.includes(key)||key.includes(k))}))continue;
    seen.add(key);out.push(item);
  }
  return out.join('\n');
}
function splitEmbeddedLabels(raw){
  const labels=['เผ่าพันธุ์','อายุ','บทบาท','สถานะ','วิถีหลัก','พรสวรรค์','บ้านเกิด','บ้านปัจจุบัน','ครอบครัว','ภูมิหลัง','ชีวิตวัยเด็ก','ชีวิตก่อนเริ่มเรื่อง','เหตุการณ์ก่อนเข้าหิมพานต์','แรงผลักดัน','ปมในใจ','จุดเด่น','จุดอ่อน','ข้อจำกัด','เส้นทางตัวละคร','ความสัมพันธ์สำคัญ','บทบาทในพล็อต','ข้อมูลเชื่อมจักรวาล','สถานะปัจจุบัน','บทบาทหลัก','เปิดตัว','Arc เด่น'];
  const out={...raw};
  for(const key of Object.keys(out)){
    let value=repairThaiText(out[key]||'').trim();
    if(!value)continue;
    const hits=[];
    for(const label of labels){
      if(label===key)continue;
      const re=new RegExp(`(?:^|\s)${label}\s*[:：]`,'g');
      let m; while((m=re.exec(value)))hits.push({label,index:m.index+(m[0].startsWith(' ')?1:0)});
    }
    hits.sort((a,b)=>a.index-b.index);
    if(!hits.length)continue;
    const first=hits[0].index;
    out[key]=value.slice(0,first).trim();
    for(let i=0;i<hits.length;i++){
      const start=hits[i].index;
      const end=i+1<hits.length?hits[i+1].index:value.length;
      const chunk=value.slice(start,end).trim();
      const val=chunk.replace(new RegExp(`^${hits[i].label}\s*[:：]\s*`),'').trim();
      if(!val)continue;
      out[hits[i].label]=out[hits[i].label]?`${out[hits[i].label]}\n${val}`:val;
    }
  }
  return out;
}
function characterSections(c){
  const raw=splitEmbeddedLabels({...(c.structured||{})});
  const labels=['เผ่าพันธุ์','อายุ','บทบาท','สถานะ','วิถีหลัก','พรสวรรค์','บ้านเกิด','บ้านปัจจุบัน','ครอบครัว','ภูมิหลัง','ชีวิตวัยเด็ก','ชีวิตก่อนเริ่มเรื่อง','เหตุการณ์ก่อนเข้าหิมพานต์','แรงผลักดัน','ปมในใจ','จุดเด่น','จุดอ่อน','เส้นทางตัวละคร','ความสัมพันธ์สำคัญ','บทบาทในพล็อต','ข้อมูลเชื่อมจักรวาล','สถานะปัจจุบัน','บทบาทหลัก','เปิดตัว','Arc เด่น'];
  const facts=repairThaiText(c.facts||'');
  const re=new RegExp(`(?:^|\\n)(${labels.sort((a,b)=>b.length-a.length).join('|')})\\s*[:：]\\s*([\\s\\S]*?)(?=\\n(?:${labels.join('|')})\\s*[:：]|$)`,'g');
  for(const m of facts.matchAll(re)){
    const key=m[1],value=dedupeCharacterText(m[2]);
    if(!value)continue;
    if(!raw[key])raw[key]=value;else if(!normalizeComparableText(raw[key]).includes(normalizeComparableText(value)))raw[key]+='\n'+value;
  }
  if(c.limits&&!raw['ข้อจำกัด'])raw['ข้อจำกัด']=c.limits;
  const cleaned={};
  const globalSeen=new Set();
  const priority=['เผ่าพันธุ์','อายุ','บทบาท','สถานะ','วิถีหลัก','พรสวรรค์','บ้านเกิด','บ้านปัจจุบัน','ครอบครัว','ภูมิหลัง','ชีวิตวัยเด็ก','ชีวิตก่อนเริ่มเรื่อง','เหตุการณ์ก่อนเข้าหิมพานต์','แรงผลักดัน','ปมในใจ','จุดเด่น','จุดอ่อน','ข้อจำกัด','เส้นทางตัวละคร','ความสัมพันธ์สำคัญ','บทบาทในพล็อต','ข้อมูลเชื่อมจักรวาล','สถานะปัจจุบัน','บทบาทหลัก','เปิดตัว','Arc เด่น'];
  for(const key of [...priority,...Object.keys(raw).filter(k=>!priority.includes(k))]){
    if(!raw[key])continue;
    const items=[];
    for(const item of splitCharacterItems(dedupeCharacterText(raw[key]))){
      let cleanedItem=item.replace(new RegExp(`^(?:${priority.join('|')})\\s*[:：]\\s*`),'').trim();
      const cmp=normalizeComparableText(cleanedItem);
      if(!cmp||globalSeen.has(cmp))continue;
      // Keep identical information in the most specific/earliest section only.
      globalSeen.add(cmp);items.push(cleanedItem);
    }
    if(items.length)cleaned[key]=items.join('\n');
  }
  return cleaned;
}
function renderStructuredCharacterText(value,section){
  const items=splitCharacterItems(dedupeCharacterText(value));
  if(!items.length)return '<p class="character-empty-text">ยังไม่มีข้อมูล</p>';
  if(section==='เส้นทางตัวละคร'){
    return `<ol class="character-path">${items.map(x=>`<li>${esc(x.replace(/^↓\\s*/,''))}</li>`).join('')}</ol>`;
  }
  const pairs=items.map(item=>{const m=item.match(/^([^:：]{1,45})[:：]\\s*(.+)$/);return m?`<div class="character-kv"><span>${esc(m[1])}</span><p>${esc(m[2])}</p></div>`:`<li>${esc(item)}</li>`});
  const hasPairs=pairs.some(x=>x.startsWith('<div'));
  return hasPairs?`<div class="character-kv-list">${pairs.join('')}</div>`:`<ul class="character-bullets">${pairs.join('')}</ul>`;
}
function characterSummary(c){
  const s=characterSections(c);const value=s['เผ่าพันธุ์']||s['บทบาท']||c.role||'ยังไม่ระบุข้อมูลย่อ';
  const first=splitCharacterItems(value)[0]||value;return first.length>90?first.slice(0,87)+'…':first;
}
function renderCharacters(p){reconcileCharacterIdentity(p);
  renderCharacterCandidates(p);
  const chars=[...(p?.characters||[])].sort((a,b)=>a.name.localeCompare(b.name,'th'));
  $('characterList').className='character-directory';
  $('characterList').innerHTML=chars.length?chars.map(c=>{const apps=characterAppearances(p,c);return `<article class="character-row" data-character-open="${c.id}"><div class="character-avatar">${esc((c.name||'?').trim().slice(0,1))}</div><div class="character-row-main"><div class="character-row-title"><h3>${esc(c.name)}</h3>${c.autoExtracted?'<span class="badge auto-badge">สกัดจากฐานข้อมูล</span>':''}</div><p>${esc(characterSummary(c))}</p><div class="character-tags"><span class="badge">${esc(c.status||'ไม่ทราบ')}</span>${c.role?`<span class="subtle-tag">${esc(c.role)}</span>`:''}<span class="subtle-tag">ปรากฏ ${apps.length} ตอน · ${apps.reduce((n,x)=>n+x.count,0)} ครั้ง</span></div></div><button class="view-character-btn" data-character-open="${c.id}">ดูข้อมูล</button></article>`}).join(''):'<div class="empty">ยังไม่มีข้อมูลตัวละคร — นำเข้า Character Bible หรือ Canon Database แล้วกด “สกัดจากเอกสาร”</div>';
  document.querySelectorAll('[data-character-open]').forEach(el=>el.onclick=e=>{e.stopPropagation();openCharacterDetail(el.dataset.characterOpen)});
}

function renderCharacterDetail(c){
  const host=$('characterDetailContent');if(!c){host.innerHTML='<div class="empty">ไม่พบข้อมูลตัวละคร</div>';return}
  const p=project(),sections=characterSections(c),apps=characterAppearances(p,c);
  const order=['ข้อมูลพื้นฐาน','เผ่าพันธุ์','อายุ','บทบาท','สถานะ','วิถีหลัก','พรสวรรค์','บ้านเกิด','บ้านปัจจุบัน','ครอบครัว','ภูมิหลัง','ชีวิตวัยเด็ก','ชีวิตก่อนเริ่มเรื่อง','เหตุการณ์ก่อนเข้าหิมพานต์','แรงผลักดัน','ปมในใจ','จุดเด่น','จุดอ่อน','ข้อจำกัด','เส้นทางตัวละคร','ความสัมพันธ์สำคัญ','บทบาทในพล็อต','ข้อมูลเชื่อมจักรวาล','สถานะปัจจุบัน','บทบาทหลัก','เปิดตัว','Arc เด่น'];
  const basics=['เผ่าพันธุ์','อายุ','บทบาท','สถานะ','วิถีหลัก','พรสวรรค์','บ้านเกิด','บ้านปัจจุบัน'];
  const compactBasic=(value)=>{const first=splitCharacterItems(value)[0]||'';return first.length>120?first.slice(0,117)+'…':first};
  const basicCards=basics.filter(k=>sections[k]).map(k=>`<div class="basic-fact" id="char-${encodeURIComponent(k)}"><span>${esc(k)}</span><strong>${esc(compactBasic(sections[k]))}</strong></div>`).join('');
  const bodyKeys=order.filter(k=>!basics.includes(k)&&sections[k]);
  const body=bodyKeys.map(k=>`<section class="character-info-section" id="char-${encodeURIComponent(k)}"><h3>${esc(k)}</h3><div class="formatted-character-text">${renderStructuredCharacterText(sections[k],k)}</div></section>`).join('');
  const extra=Object.entries(sections).filter(([k,v])=>!order.includes(k)&&v).map(([k,v])=>`<section class="character-info-section" id="char-${encodeURIComponent(k)}"><h3>${esc(k)}</h3><div class="formatted-character-text">${renderStructuredCharacterText(v,k)}</div></section>`).join('');
  const nav=[...basics.filter(k=>sections[k]),...bodyKeys,'ปรากฏในตอน','แหล่งข้อมูล'];
  const appearances=apps.length?apps.map((a,i)=>`<button class="appearance-row" data-appearance-index="${i}"><div><strong>${esc(a.title)}</strong><p>${esc(a.snippet)}</p></div><span>${a.count} ครั้ง →</span></button>`).join(''):'<div class="empty compact">ยังไม่พบชื่อตัวละครนี้ในเนื้อหานิยายที่นำเข้าหรือเขียนไว้</div>';
  host.innerHTML=`<article class="character-profile-hero"><div class="character-profile-avatar">${esc((c.name||'?').trim().slice(0,1))}</div><div class="character-profile-heading"><div class="profile-badges"><span class="badge">${esc(c.status||'ไม่ทราบ')}</span>${c.autoExtracted?'<span class="badge auto-badge">สกัดจากฐานข้อมูล</span>':''}<span class="badge">${apps.length} ตอน</span></div><h2>${esc(c.name)}</h2><p>${esc(c.role||'ยังไม่ระบุบทบาท')}</p>${c.aliases?.length?`<div class="aliases">ชื่อเรียกอื่น: ${esc(c.aliases.join(', '))}</div>`:''}</div></article><nav class="character-jump-nav">${nav.map(k=>`<button data-char-jump="char-${encodeURIComponent(k)}">${esc(k)}</button>`).join('')}</nav>${basicCards?`<div class="basic-facts-grid">${basicCards}</div>`:''}<div class="character-sections-grid">${body||'<div class="empty">ยังไม่มีข้อมูลแบบจัดหมวดหมู่</div>'}${extra}</div><section class="character-info-section" id="char-${encodeURIComponent('ปรากฏในตอน')}"><h3>ปรากฏในตอน</h3><p class="section-note">ดึงจากเนื้อหานิยายโดยค้นชื่อหลักและชื่อเรียกอื่น กดรายการเพื่อเปิดตอนนั้น</p><div class="appearance-list">${appearances}</div></section><div class="character-source-card" id="char-${encodeURIComponent('แหล่งข้อมูล')}"><strong>แหล่งข้อมูล</strong><p>${esc(c.source||'เพิ่มด้วยตนเอง')}</p>${c.source?`<button id="openCharacterSource">เปิดไฟล์ต้นทาง</button>`:''}</div>`;
  document.querySelectorAll('[data-char-jump]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.charJump)?.scrollIntoView({behavior:'smooth',block:'start'}));
  document.querySelectorAll('[data-appearance-index]').forEach(b=>b.onclick=()=>openAppearance(apps[Number(b.dataset.appearanceIndex)]));
  const src=$('openCharacterSource');if(src)src.onclick=()=>focusSourceDocument(c.source);
}

function openCharacterDetail(id){currentCharacterId=id;const c=project()?.characters.find(x=>x.id===id);renderCharacterDetail(c);switchView('characterDetail')}
function renderTimeline(p){const items=[...(p?.timeline||[])].sort((a,b)=>(a.order||999999)-(b.order||999999));$('timelineList').innerHTML=items.length?items.map(t=>`<article class="timeline-item"><span class="badge">${esc(t.label||'ไม่ระบุเวลา')}${t.chapter?` · ตอน ${esc(t.chapter)}`:''}</span><h3>${esc(t.title)}</h3><p>${esc(t.details||'')}</p><div class="meta">${esc(t.source||'ไม่มีแหล่งอ้างอิง')}</div><div class="card-actions"><button data-time-edit="${t.id}">แก้ไข</button><button data-time-delete="${t.id}" class="danger outline">ลบ</button></div></article>`).join(''):'<div class="empty">ยังไม่มี Timeline</div>';document.querySelectorAll('[data-time-edit]').forEach(b=>b.onclick=()=>timelineModal(p.timeline.find(x=>x.id===b.dataset.timeEdit)));document.querySelectorAll('[data-time-delete]').forEach(b=>b.onclick=async()=>{if(confirm('ลบเหตุการณ์นี้หรือไม่?')){p.timeline=p.timeline.filter(x=>x.id!==b.dataset.timeDelete);await save()}})}
function renderChapters(p){
  const items=[
    ...derivedChapters(p).map(d=>({...d,source:'imported'})),
    ...(p?.chapters||[]).map(c=>({...c,name:c.title,source:'manual'}))
  ].sort((a,b)=>chapterSortNumber(a)-chapterSortNumber(b)||String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
  $('chapterList').innerHTML=items.length?items.map(c=>`<div class="list-row chapter-saved-row"><div class="grow"><span class="badge">${c.source==='imported'?'นำเข้า':'เขียนในแอป'}</span><strong>${esc(chapterDisplayTitle(c))}</strong><p>${textStats(c.text||'').chars.toLocaleString('th-TH')} ตัวอักษร · ${new Date(c.updatedAt||c.createdAt).toLocaleString('th-TH')}</p></div><div class="saved-chapter-actions"><button data-chapter-open="${c.id}" data-chapter-source="${c.source}">แก้ไข</button><button data-chapter-delete="${c.id}" data-chapter-source="${c.source}" class="danger outline">ลบ</button></div></div>`).join(''):'<div class="empty">ยังไม่มีตอนที่บันทึกหรือนำเข้า</div>';
  document.querySelectorAll('[data-chapter-open]').forEach(b=>b.onclick=()=>{
    const source=b.dataset.chapterSource;
    const item=source==='imported'?p.documents.find(x=>x.id===b.dataset.chapterOpen):p.chapters.find(x=>x.id===b.dataset.chapterOpen);
    if(item)loadChapter(item,source);
  });
  document.querySelectorAll('[data-chapter-delete]').forEach(b=>b.onclick=async()=>{
    const source=b.dataset.chapterSource,id=b.dataset.chapterDelete;
    const item=source==='imported'?p.documents.find(x=>x.id===id):p.chapters.find(x=>x.id===id);
    if(!item||!confirm(`ลบ “${chapterDisplayTitle(item)}” หรือไม่?`))return;
    if(source==='imported')p.documents=p.documents.filter(x=>x.id!==id);else p.chapters=p.chapters.filter(x=>x.id!==id);
    if(currentChapterId===id){currentChapterId=null;currentChapterSource='manual';$('chapterTitle').value='';$('chapterText').value='';updateEditorStats()}
    activity('chapter',`ลบตอน ${chapterDisplayTitle(item)}`);await save();toast('ลบตอนแล้ว');
  })
}
function renderIssues(p){const issues=p?.issues||[];const counts={high:0,medium:0,low:0};issues.forEach(i=>counts[i.severity]=(counts[i.severity]||0)+1);$('checkSummary').innerHTML=issues.length?`<div class="summary-grid"><div class="summary-box"><strong>${issues.length}</strong><span>รายการทั้งหมด</span></div><div class="summary-box"><strong>${counts.high}</strong><span>ระดับสูง</span></div><div class="summary-box"><strong>${counts.medium}</strong><span>ควรตรวจ</span></div><div class="summary-box"><strong>${counts.low}</strong><span>ผ่านเบื้องต้น</span></div></div>`:'ยังไม่มีผลตรวจ';$('issueList').innerHTML=issues.length?issues.map(i=>`<article class="issue ${i.severity}"><span class="badge">${esc(i.type)}</span><h3>${esc(i.title)}</h3>${i.excerpt?`<blockquote>${esc(i.excerpt)}</blockquote>`:''}<p><strong>หลักฐาน:</strong> ${esc(i.evidence)}</p><div class="meta">แหล่งอ้างอิง: ${esc(i.source)}</div><p><strong>ข้อเสนอ:</strong> ${esc(i.suggestion)}</p></article>`).join(''):'<div class="empty">กด “เริ่มตรวจบทปัจจุบัน” หลังใส่ต้นฉบับ</div>'}
function renderDNA(p){const d=p?.dna;if(!d){$('dnaStats').innerHTML=[['เอกสาร',0],['ตัวอักษร',0],['ย่อหน้า',0],['เฉลี่ย/ย่อหน้า',0]].map(([n,v])=>`<div class="stat"><strong>${v}</strong><span>${n}</span></div>`).join('');$('topWords').innerHTML='<div class="empty">ยังไม่ได้วิเคราะห์</div>';$('dnaNotes').innerHTML='<div class="empty">นำเข้าต้นฉบับหรือบันทึกตอนก่อน</div>';return}$('dnaStats').innerHTML=[['แหล่งข้อความ',d.documents],['ตัวอักษร',d.chars],['ย่อหน้า',d.paras],['เฉลี่ย/ย่อหน้า',d.avgParagraphChars]].map(([n,v])=>`<div class="stat"><strong>${Number(v).toLocaleString('th-TH')}</strong><span>${n}</span></div>`).join('');$('topWords').innerHTML=d.top.map(([w,n])=>`<span class="tag">${esc(w)} · ${n}</span>`).join('');const notes=[`ความยาวย่อหน้าเฉลี่ยประมาณ ${d.avgParagraphChars} ตัวอักษร`,`พบ ${d.sentences.toLocaleString('th-TH')} ช่วงประโยคจากข้อความทั้งหมด`,d.dialogueSignal>25?'มีสัญญาณการใช้บทสนทนาค่อนข้างมาก':'สัดส่วนบทสนทนาไม่สูงเมื่อเทียบกับคำบรรยาย',`วิเคราะห์ล่าสุด ${new Date(d.analyzedAt).toLocaleString('th-TH')}`];$('dnaNotes').innerHTML=notes.map(n=>`<div class="list-row"><div class="grow"><strong>${esc(n)}</strong></div></div>`).join('')}

function setSidebarOpen(open){
  const side=$('.sidebar'),over=$('sidebarOverlay');
  if(!side)return;
  const shouldOpen=innerWidth<901&&!!open;
  side.classList.toggle('open',shouldOpen);
  side.setAttribute('aria-hidden',shouldOpen?'false':'true');
  if(over){over.classList.toggle('show',shouldOpen);over.setAttribute('aria-hidden',shouldOpen?'false':'true')}
  document.documentElement.classList.toggle('menu-open',shouldOpen);
  document.body.classList.toggle('menu-open',shouldOpen);
  const btn=$('menuBtn');if(btn)btn.setAttribute('aria-expanded',shouldOpen?'true':'false');
}
window.toggleNovelMenu=()=>setSidebarOpen(!$('.sidebar')?.classList.contains('open'));
window.closeNovelMenu=()=>setSidebarOpen(false);
const menuBtn=$('menuBtn'),closeBtn=$('sidebarCloseBtn'),menuOverlay=$('sidebarOverlay'),sidebarEl=$('.sidebar');
menuBtn?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();window.toggleNovelMenu()});
closeBtn?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();window.closeNovelMenu()});
['pointerdown','touchstart','click'].forEach(type=>menuOverlay?.addEventListener(type,e=>{e.preventDefault();e.stopPropagation();window.closeNovelMenu()},{passive:false}));
document.addEventListener('keydown',e=>{if(e.key==='Escape')window.closeNovelMenu()});
document.addEventListener('pointerdown',e=>{if(innerWidth>=901||!sidebarEl?.classList.contains('open'))return;if(sidebarEl.contains(e.target)||menuBtn?.contains(e.target))return;window.closeNovelMenu()},{capture:true});
document.querySelectorAll('#nav button').forEach(b=>b.addEventListener('click',()=>window.closeNovelMenu()));
let menuTouchStartX=null;
sidebarEl?.addEventListener('touchstart',e=>{menuTouchStartX=e.touches?.[0]?.clientX??null},{passive:true});
sidebarEl?.addEventListener('touchend',e=>{if(menuTouchStartX==null)return;const x=e.changedTouches?.[0]?.clientX??menuTouchStartX;if(menuTouchStartX-x>45)window.closeNovelMenu();menuTouchStartX=null},{passive:true});
window.addEventListener('resize',()=>{if(innerWidth>=901)window.closeNovelMenu()});
window.addEventListener('pageshow',()=>window.closeNovelMenu());
document.querySelectorAll('#nav button').forEach(b=>b.onclick=()=>switchView(b.dataset.view));document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>switchView(b.dataset.go));
$('newProjectBtn').onclick=createProjectModal;$('activeProjectSelect').onchange=async e=>{state.activeProjectId=e.target.value;currentChapterId=null;currentChapterSource='manual';$('chapterTitle').value='';$('chapterText').value='';await save()};
$('openCanonModal').onclick=()=>canonModal();$('openCharacterModal').onclick=()=>characterModal();$('openTimelineModal').onclick=()=>timelineModal();
$('extractCharactersBtn').onclick=extractCharactersFromAllDocuments;$('scanNovelCharactersBtn').onclick=scanNovelCharacters;
$('backToCharacters').onclick=()=>switchView('characters');
$('editCharacterDetail').onclick=()=>{const c=project()?.characters.find(x=>x.id===currentCharacterId);if(c)characterModal(c)};
$('deleteCharacterDetail').onclick=async()=>{const p=project(),c=p?.characters.find(x=>x.id===currentCharacterId);if(c&&confirm(`ลบตัวละคร “${c.name}” หรือไม่?`)){p.characters=p.characters.filter(x=>x.id!==currentCharacterId);currentCharacterId=null;await save();switchView('characters')}};

$('syncCanonBtn').onclick=async()=>{if(!ensureProject())return;const p=project();let total=0,docs=0;for(const d of sourceDocuments(p,'canon')){total+=syncCanonFromDocument(p,d);docs++}activity('canon',`ซิงก์ Canon จาก ${docs} เอกสาร ได้ ${total} หัวข้อ`);await save();toast(`ซิงก์ Canon ${total} หัวข้อจาก ${docs} เอกสาร`)};
$('canonSearch').oninput=()=>renderCanon(project());$('canonFilter').onchange=()=>renderCanon(project());$('documentSearch').oninput=()=>renderDocuments(project());$('documentType').onchange=()=>renderDocuments(project());$('novelSearch').oninput=()=>renderNovelContent(project());$('backToNovelContent').onclick=()=>switchView('novelContent');
$('novelReaderBody').addEventListener('copy',e=>{e.preventDefault();toast('หน้านี้เป็นโหมดอ่านอย่างเดียว')});$('novelReaderBody').addEventListener('cut',e=>e.preventDefault());$('novelReaderBody').addEventListener('contextmenu',e=>e.preventDefault());
async function importSelectedFiles(files,inputEl,{openLibrary=false}={}){
  if(!ensureProject())return;
  files=[...files];const p=project();let success=0,createdChapters=0,updatedFiles=0;const failed=[];
  if(!files.length)return;if(inputEl)inputEl.disabled=true;
  for(let i=0;i<files.length;i++){
    const f=files[i];$('importStatus').textContent=`กำลังตรวจสอบ ${i+1}/${files.length}: ${f.name}`;
    try{
      const parsed=await extractFile(f),ext=f.name.split('.').pop().toLowerCase();
      if(ext==='pdf'){
        const quality=pdfQualityResult(parsed);
        if(!quality.ok)throw new Error(`ปฏิเสธ PDF: ${quality.reasons.join(' · ')} กรุณาใช้ DOCX หรือ Export PDF ใหม่`);
        parsed.pdfQuality=quality;
      }
      const detectedType=detectDocumentType(f.name,parsed.text||''),sourceKey=normalizedSourceKey(f.name);
      const existed=(p.documents||[]).some(d=>d.sourceKey===sourceKey&&!d.derivedChapter);
      const sourceDoc={id:uid(),name:f.name,sourceFileName:f.name,sourceKey,type:detectedType,isSourceDocument:true,derivedChapter:false,
        text:parsed.text||'',blocks:parsed.blocks||null,pages:parsed.pages||null,pageCount:parsed.pageCount||null,pdfBase64:parsed.pdfBase64||null,
        pdfQuality:parsed.pdfQuality||null,extractionVersion:parsed.extractionVersion||null,warnings:parsed.warnings||[],size:f.size,
        createdAt:now(),updatedAt:now()};
      const chapterDocs=buildChapterDocuments(f,parsed,detectedType,sourceDoc);
      if(detectedType==='chapter'&&!chapterDocs.length)throw new Error('พบว่าเป็นต้นฉบับ แต่ไม่พบหัวข้อรูปแบบ “บทที่/ตอนที่ เลข : ชื่อ” จึงยังไม่บันทึกไฟล์');
      if(existed){removeSourceAndDerived(p,sourceKey);updatedFiles++}
      p.documents.push(sourceDoc);
      if(chapterDocs.length){p.documents.push(...chapterDocs);createdChapters+=chapterDocs.length}
      if(detectedType==='canon'){
        const canonCount=syncCanonFromDocument(p,sourceDoc);
        sourceDoc.canonExtractedCount=canonCount;
      }
      if(detectedType==='character'||/SHP[_-]?08A?|CHARACTER(?:_|\s|-)?(?:DATABASE|BIBLE)|ตัวละคร/i.test(f.name||'')){
        const extracted=extractCharactersFromDocument(p,sourceDoc);
        if(extracted.total){const box=$('characterExtractStatus');box.hidden=false;box.textContent=`จาก ${f.name}: พบ ${extracted.total} รายการ · เพิ่ม ${extracted.added} · อัปเดต ${extracted.updated}`}
      }
      activity('document',`${existed?'อัปเดต':'นำเข้า'} ${f.name} เป็น ${documentTypeLabel(detectedType)}${chapterDocs.length?` และแยก ${chapterDocs.length} บท/ตอน`:''}`);
      success++;await setDB(state);
    }catch(err){failed.push(`${f.name}: ${err?.message||'อ่านไฟล์ไม่สำเร็จ'}`)}
    await new Promise(r=>setTimeout(r,0));
  }
  if(inputEl){inputEl.value='';inputEl.disabled=false}await save('บันทึกแล้ว');
  const detail=[createdChapters?`แยก ${createdChapters} บท/ตอน`:'',updatedFiles?`อัปเดตแทนไฟล์เดิม ${updatedFiles} ไฟล์`:''].filter(Boolean).join(' · ');
  if(failed.length){$('importStatus').innerHTML=`สำเร็จ ${success} ไฟล์${detail?` · ${detail}`:''} · ปฏิเสธ ${failed.length} ไฟล์<br><small>${esc(failed.slice(0,8).join(' | '))}</small>`;toast(`สำเร็จ ${success} ไฟล์ ปฏิเสธ ${failed.length} ไฟล์`)}
  else{$('importStatus').textContent=`สำเร็จ ${success} ไฟล์${detail?` · ${detail}`:''}`;toast(updatedFiles?'อัปเดตข้อมูลเดิมเรียบร้อย':'นำเข้าสำเร็จ')}
  if(openLibrary){switchView('documents');renderDocuments(project())}
}
$('documentInput').onchange=e=>importSelectedFiles(e.target.files,e.target);
$('dashboardDocumentInput').onchange=e=>importSelectedFiles(e.target.files,e.target,{openLibrary:true});

$('clearDocumentCategory').onclick=async()=>{
  if(!ensureProject())return;const p=project(),type=$('documentType').value,label=documentTypeLabel(type);
  const sourceIds=new Set(sourceDocuments(p,type).map(d=>d.id));
  if(!sourceIds.size)return toast(`ยังไม่มีข้อมูล ${label}`);
  if(!confirm(`ลบข้อมูล “${label}” ทั้งหมด รวมข้อมูลที่แยกหรือสกัดจากไฟล์เหล่านี้หรือไม่?`))return;
  p.documents=p.documents.filter(d=>d.type!==type&&!sourceIds.has(d.sourceDocumentId));
  if(type==='character')p.characters=[];if(type==='canon')p.canon=[];if(type==='timeline')p.timeline=[];
  currentNovelDocumentId=null;activity('document',`ลบข้อมูล ${label} ทั้งหมด`);await save();toast(`ลบ ${label} ทั้งหมดแล้ว`)
};

$('chapterText').oninput=()=>{updateEditorStats();autosaveDraft()};$('chapterTitle').oninput=autosaveDraft;
$('newChapter').onclick=()=>{currentChapterId=null;currentChapterSource='manual';$('chapterTitle').value='';$('chapterText').value='';updateEditorStats();$('autosaveState').textContent='บทใหม่'};
$('saveChapter').onclick=async()=>{if(!ensureProject())return;const p=project(),title=$('chapterTitle').value.trim()||'บทไม่มีชื่อ',text=$('chapterText').value;
  if(currentChapterId&&currentChapterSource==='imported'){
    const d=p.documents.find(x=>x.id===currentChapterId);
    if(!d)return toast('ไม่พบตอนนำเข้านี้');
    Object.assign(d,{title,name:title,text,updatedAt:now(),editedInApp:true});
  }else if(currentChapterId){
    const c=p.chapters.find(x=>x.id===currentChapterId);
    if(c)Object.assign(c,{title,text,updatedAt:now()});
  }else{
    const c={id:uid(),title,text,createdAt:now(),updatedAt:now()};p.chapters.push(c);currentChapterId=c.id;currentChapterSource='manual';
  }
  activity('chapter',`บันทึกตอน ${title}`);await save();$('autosaveState').textContent='บันทึกแล้ว';toast('บันทึกตอนแล้ว')
};
$('runChecker').onclick=async()=>{if(!ensureProject())return;const text=$('chapterText').value.trim();if(!text)return toast('กรุณาใส่เนื้อหาบทก่อน');project().issues=checkChapter(text,project());activity('check',`ตรวจความขัดแย้ง ${project().issues.length} รายการ`);await save();switchView('checker');toast('ตรวจเสร็จแล้ว')};
$('analyzeDNA').onclick=analyzeDNA;
$('scannerInput').onchange=async e=>{const files=[...(e.target.files||[])];if(files.length)await handleScannerFiles(files);e.target.value=''};
$('copyScannerText').onclick=async()=>{const t=$('scannerText').value;if(!t)return toast('ยังไม่มีข้อความ');try{await navigator.clipboard.writeText(t);toast('คัดลอกข้อความแล้ว')}catch(_){$('scannerText').select();document.execCommand('copy');toast('คัดลอกข้อความแล้ว')}};
$('clearScannerText').onclick=()=>{$('scannerText').value='';$('scannerRawText').value='';$('scannerPreview').innerHTML='';$('scannerStatus').hidden=true};
$('showScannerClean').onclick=()=>setScannerMode('clean');
$('showScannerRaw').onclick=()=>setScannerMode('raw');

function download(obj,name){const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
$('exportBackup').onclick=()=>download(state,`novel-studio-backup-${new Date().toISOString().slice(0,10)}.noveldb.json`);$('exportProject').onclick=()=>{if(ensureProject())download(project(),`${project().name.replace(/[^\p{L}\p{N}_-]+/gu,'-')}.noveldb.json`)};
$('importBackup').onchange=async e=>{try{const x=JSON.parse(await e.target.files[0].text());if(!Array.isArray(x.projects))throw new Error('รูปแบบไฟล์ไม่ถูกต้อง');state={version:x.version||1,projects:x.projects.map(normalizeProject),activeProjectId:x.activeProjectId||x.projects[0]?.id||null};await save();toast('กู้คืนข้อมูลแล้ว')}catch(err){toast(err.message||'นำเข้าไม่สำเร็จ')}e.target.value=''};
$('deleteProject').onclick=async()=>{if(!ensureProject())return;if(confirm(`ลบโปรเจกต์ “${project().name}” หรือไม่?`)){state.projects=state.projects.filter(x=>x.id!==state.activeProjectId);state.activeProjectId=state.projects[0]?.id||null;await save();toast('ลบโปรเจกต์แล้ว')}};$('clearAll').onclick=async()=>{if(confirm('ล้างข้อมูลทุกโปรเจกต์หรือไม่? การกระทำนี้ย้อนกลับไม่ได้')){state={version:1,projects:[],activeProjectId:null};await save();toast('ล้างข้อมูลแล้ว')}};
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('installBtn').hidden=false});$('installBtn').onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('installBtn').hidden=true}};

function normalizeScannerLine(line){
  return cleanScannerInlineNoise(repairThaiText(String(line||''))
    .replace(/[\u200B-\u200D\uFEFF]/g,''))
    .replace(/[ \t]+/g,' ')
    .trim();
}
function scannerWordTokens(text){
  return normalizeScannerLine(text).match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)||[];
}
function scannerHasMeaningfulEnglish(text){
  const tokens=scannerWordTokens(text);
  if(!tokens.length)return false;
  const known=new Set(['a','an','and','are','as','at','be','but','by','can','chapter','core','dark','database','death','do','document','for','from','ghost','good','hello','hp','i','in','is','it','king','level','lord','mission','mp','necropolis','no','not','of','on','or','page','rank','raw','room','skill','soul','spirit','status','system','thank','the','to','up','wake','with','you','your']);
  const alpha=tokens.join('').length;
  const sensible=tokens.filter(w=>w.length>=2&&(known.has(w.toLowerCase())||/[aeiouy]/i.test(w))).length;
  return alpha>=3&&sensible>=Math.max(1,Math.ceil(tokens.length*.5));
}
function scannerLooksLikeStatusHeader(t){
  return /^\d{1,2}:\d{2}\b/.test(t)&&(/(?:จันทร์|อังคาร|พุธ|พฤหัสบดี|ศุกร์|เสาร์|อาทิตย์)/.test(t)||/\b\d{1,3}%\b/.test(t)||/(?:wifi|5g|4g|lte|แบต)/i.test(t));
}
function scannerLooksLikeGarbage(t){
  if(!t)return false;
  if(scannerHasMeaningfulEnglish(t))return false;
  const letters=(t.match(/[\p{L}]/gu)||[]).length;
  const symbols=(t.match(/[^\p{L}\p{N}\s]/gu)||[]).length;
  const latin=(t.match(/[A-Za-z]/g)||[]).length;
  const thai=(t.match(/[\u0E00-\u0E7F]/g)||[]).length;
  if(/^o\s*wo\s*=\s*a\s*wo/i.test(t))return true;
  if(/^(?:[A-Za-z]\s*){1,3}[=<>«»£¥€$&@%]+/i.test(t))return true;
  if(/^[\d\s@%๐-๙()=<>«»£¥€$&.,:;!?+\-_/\\]{5,}$/.test(t))return true;
  if(letters===0&&symbols>=2)return true;
  if(latin>0&&thai===0&&symbols>=2&&latin<8)return true;
  return false;
}
function isScannerJunkLine(line){
  const t=normalizeScannerLine(line);
  if(!t)return false;
  if(/^={3,}\s*(?:IMG[_-]?\d+\.(?:png|jpe?g|webp)|.+\.pdf)\s*={3,}$/i.test(t))return true;
  if(/^(?:IMG[_-]?\d+\.(?:png|jpe?g|webp)|.+\.pdf)$/i.test(t))return true;
  if(/^(?:หน้า|page)\s*\d+(?:\s*\/\s*\d+)?$/i.test(t))return true;
  if(/^(?:https?:\/\/)?(?:www\.)?(?:writer\.dek-d\.com|dek-d\.com|github\.com|maxsukung\.github\.io)\/?$/i.test(t))return true;
  if(scannerLooksLikeStatusHeader(t))return true;
  if(/^[\W_]*(?:wifi|5g|4g|lte|battery|แบตเตอรี่)[\W_]*$/i.test(t))return true;
  if(/^(?:ข้อความสะอาด|ข้อความดิบ|คัดลอกข้อความ(?:สะอาด)?|ล้างข้อความ)$/i.test(t))return true;
  return scannerLooksLikeGarbage(t);
}
function scannerComparable(text){
  return normalizeScannerLine(text).toLocaleLowerCase('th').replace(/[^\p{L}\p{N}]+/gu,'');
}
function scannerSimilarity(a,b){
  const x=scannerComparable(a),y=scannerComparable(b);
  if(!x||!y)return 0;
  if(x===y)return 1;
  const short=x.length<y.length?x:y,long=x.length<y.length?y:x;
  if(long.includes(short)&&short.length/long.length>.88)return short.length/long.length;
  const grams=s=>{const out=new Set();for(let i=0;i<s.length-2;i++)out.add(s.slice(i,i+3));return out};
  const A=grams(x),B=grams(y);if(!A.size||!B.size)return 0;
  let hit=0;for(const g of A)if(B.has(g))hit++;
  return (2*hit)/(A.size+B.size);
}
function dedupeScannerLines(lines){
  const out=[];
  for(const raw of lines){
    const line=normalizeScannerLine(raw);
    if(!line){if(out.length&&out[out.length-1]!=='')out.push('');continue}
    if(isScannerJunkLine(line))continue;
    const recent=out.slice(-12).filter(Boolean);
    if(recent.some(x=>scannerSimilarity(x,line)>.965))continue;
    out.push(line);
  }
  return out;
}
function dedupeScannerParagraphs(paras){
  const out=[];
  for(const p of paras){
    const text=normalizeScannerLine(p.replace(/\n/g,' '));
    if(!text)continue;
    const duplicate=out.some(prev=>scannerSimilarity(prev,text)>.94);
    if(!duplicate)out.push(p.trim());
  }
  return out;
}
function mergeScannerBlocks(blocks){
  const clean=[];
  for(const block of blocks){
    const text=cleanScannerText(block);
    if(!text)continue;
    if(!clean.length){clean.push(text);continue}
    const prev=clean[clean.length-1];
    const a=prev.split('\n').filter(Boolean),b=text.split('\n').filter(Boolean);
    let overlap=0,max=Math.min(12,a.length,b.length);
    for(let n=max;n>=1;n--){
      const tail=a.slice(-n).map(scannerComparable).join('|');
      const head=b.slice(0,n).map(scannerComparable).join('|');
      if(tail&&tail===head){overlap=n;break}
    }
    if(overlap){clean[clean.length-1]=[...a,...b.slice(overlap)].join('\n')}
    else if(scannerSimilarity(prev,text)<.94)clean.push(text);
  }
  return dedupeScannerParagraphs(clean.join('\n\n').split(/\n{2,}/)).join('\n\n');
}
function cleanScannerInlineNoise(text){
  return String(text||'')
    // ขยะ OCR ที่มักติดอยู่กลางบรรทัด ไม่ใช่เฉพาะทั้งบรรทัด
    .replace(/\bo\s*wo\s*=\s*a\s*wo\s*dur\s*a\b/gi,' ')
    .replace(/(?:^|\s)[@©®]?[\s]*(?:\d{1,3}%|[๐-๙]{1,3}%)(?:\s*[()๐-๙A-Za-z@©®=:+-]*)?(?=\s|$)/g,' ')
    .replace(/(?:^|\s)(?:[๐-๙0-9]{1,3}\s+){3,}[A-Za-z]?\s*(?=\s|$)/g,' ')
    .replace(/(?:^|\s)[A-Za-z]?(?:\s*[«»£¥€$&@=<>]){1,}[^\p{L}\n]{0,18}(?=\s|$)/gu,' ')
    .replace(/\b(?:writer\.dek-d\.com|dek-d\.com|maxsukung\.github\.io)\b/gi,' ')
    .replace(/(?:^|\s)\d{1,2}\s+(?:ม\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.|ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.)\s*\d{2,4}\s*[-–—]\s*[\d.]+K?\s*ตัวอักษร(?:\s*\([^)]*\))?/gi,' ')
    .replace(/ลำดับตอนที่\s*#?\s*\d+\s*[:：]\s*/gi,' ')
    .replace(/\s+([,.!?;:…])/g,'$1')
    .replace(/[ \t]{2,}/g,' ')
    .trim();
}
function cleanScannerText(raw){
  let text=repairThaiText(String(raw||''))
    .replace(/\r\n?/g,'\n')
    .replace(/^={3,}.*?={3,}\s*$/gm,'')
    .replace(/[\u200B-\u200D\uFEFF]/g,'');
  text=text.split('\n').map(cleanScannerInlineNoise).join('\n');
  let lines=dedupeScannerLines(text.split('\n'));
  while(lines.length&&!lines[0])lines.shift();while(lines.length&&!lines[lines.length-1])lines.pop();
  const paras=[];let buf=[];
  const flush=()=>{if(buf.length){const p=buf.join(' ').replace(/\s+([,.!?;:…])/g,'$1').replace(/\s{2,}/g,' ').trim();if(p)paras.push(p);buf=[]}};
  for(const line of lines){
    if(!line){flush();continue}
    if(/^[-—–_─]{3,}$/.test(line)){flush();if(paras[paras.length-1]!=='──────────')paras.push('──────────');continue}
    const isHeading=/^(?:บทที่|ตอนที่|ลำดับตอนที่|ภาคที่|ตลาดชะตาฟ้า)\b/i.test(line);
    const isDialogue=/^[“"'‘]/.test(line)||/[”"'’]$/.test(line);
    const isShortBeat=line.length<=45&&/(?:กล่าว|ถาม|ตอบ|ตะโกน|กระซิบ|พึมพำ|ถอนหายใจ|หลับตา|ลืมตา|เงียบ|นิ่ง)$/.test(line);
    if(isHeading||isDialogue||isShortBeat){flush();paras.push(line);continue}
    if(buf.length&&/[.!?…ฯ”"'’]$/.test(buf[buf.length-1]))flush();
    buf.push(line);
  }
  flush();
  return dedupeScannerParagraphs(paras).join('\n\n').replace(/\n{3,}/g,'\n\n').trim();
}
function setScannerMode(mode){
  const clean=$('scannerText'),raw=$('scannerRawText');
  const rawMode=mode==='raw';clean.hidden=rawMode;raw.hidden=!rawMode;
  $('showScannerClean').classList.toggle('primary',!rawMode);$('showScannerRaw').classList.toggle('primary',rawMode);
}
async function scannerOcrImage(source,label='รูปภาพ'){
  if(!window.Tesseract)throw new Error('ยังโหลดตัวอ่าน OCR ไม่สำเร็จ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่');
  const status=$('scannerStatus');status.hidden=false;status.textContent=`กำลังอ่านข้อความจาก ${label}…`;
  const result=await window.Tesseract.recognize(source,'tha+eng',{logger:m=>{if(m.status&&typeof m.progress==='number')status.textContent=`${label}: ${m.status} ${Math.round(m.progress*100)}%`}});
  return repairThaiText(result?.data?.text||'').trim();
}
async function scanPdfFile(file){
  const lib=await getPdfJs(),bytes=new Uint8Array(await file.arrayBuffer());
  const pdf=await lib.getDocument({data:bytes}).promise;const parts=[];
  for(let i=1;i<=pdf.numPages;i++){
    const page=await pdf.getPage(i),content=await page.getTextContent();
    const plain=pdfItemsToStructuredLines(content.items).map(x=>x.text).join('\n').trim();
    if(plain.length>40){parts.push(plain);continue}
    const viewport=page.getViewport({scale:1.8}),canvas=document.createElement('canvas');
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
    parts.push(await scannerOcrImage(canvas,`PDF หน้า ${i}/${pdf.numPages}`));
  }
  return parts.join('\n\n');
}
function scannerFileOrder(file){const m=String(file.name||'').match(/(\d+)(?!.*\d)/);return m?Number(m[1]):Number.MAX_SAFE_INTEGER}
async function handleScannerFiles(files){
  const status=$('scannerStatus'),preview=$('scannerPreview'),out=$('scannerText'),rawOut=$('scannerRawText');
  status.hidden=false;preview.innerHTML='';const rawBlocks=[];const ordered=[...files].sort((a,b)=>scannerFileOrder(a)-scannerFileOrder(b)||a.name.localeCompare(b.name,'th'));
  for(const file of ordered){
    try{
      if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){rawBlocks.push(await scanPdfFile(file))}
      else if(file.type.startsWith('image/')){const url=URL.createObjectURL(file);preview.insertAdjacentHTML('beforeend',`<figure><img src="${url}" alt="${esc(file.name)}"><figcaption>${esc(file.name)}</figcaption></figure>`);rawBlocks.push(await scannerOcrImage(url,file.name));setTimeout(()=>URL.revokeObjectURL(url),60000)}
    }catch(err){rawBlocks.push(`[อ่าน ${file.name} ไม่สำเร็จ: ${err?.message||err}]`)}
  }
  rawOut.value=rawBlocks.join('\n\n');out.value=mergeScannerBlocks(rawBlocks);setScannerMode('clean');
  status.textContent=`อ่านเสร็จแล้ว ${ordered.length} ไฟล์ · ทำความสะอาดหัว–ท้ายและรวมข้อความซ้ำแล้ว`;
}

const APP_VERSION='41';
let updateReloading=false,lastSeenVersion=APP_VERSION;
async function checkForAppUpdate(registration){
  try{
    await registration.update();
    const response=await fetch(`./version.json?t=${Date.now()}`,{cache:'no-store'});
    if(response.ok){const data=await response.json();const remote=String(data.version||'');if(remote&&remote!==lastSeenVersion){lastSeenVersion=remote;toast('พบเวอร์ชันใหม่ กำลังอัปเดต…');if(registration.waiting)registration.waiting.postMessage({type:'SKIP_WAITING'})}}
  }catch(_){/* offline: keep current app */}
}
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>{
    checkForAppUpdate(reg);
    setInterval(()=>checkForAppUpdate(reg),30000);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkForAppUpdate(reg)});
    window.addEventListener('focus',()=>checkForAppUpdate(reg));
    reg.addEventListener('updatefound',()=>{const worker=reg.installing;if(!worker)return;worker.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller){toast('พบเวอร์ชันใหม่ กำลังอัปเดต…');worker.postMessage({type:'SKIP_WAITING'})}})});
  });
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(updateReloading)return;updateReloading=true;location.reload()});
}

history.scrollRestoration='manual';
(async()=>{window.scrollTo(0,0);const loaded=await getDB();if(loaded){state={version:loaded.version||1,projects:(loaded.projects||[]).map(normalizeProject),activeProjectId:loaded.activeProjectId||loaded.projects?.[0]?.id||null}}for(const p of state.projects||[])reconcileCharacterIdentity(p);const vb=document.getElementById('appVersionBadge');if(vb)vb.textContent=`V${APP_VERSION}`;renderAll();updateEditorStats();if(loaded)await save()})();
