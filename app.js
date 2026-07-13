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
    pdfjsLib=await import('./pdf.legacy.min.mjs?v=6');
    pdfjsLib.GlobalWorkerOptions.workerSrc='./pdf.legacy.worker.min.mjs';
  }
  return pdfjsLib;
}

const DB='NovelStudioDB', VER=1, STORE='state', KEY='app';
let state={version:1,projects:[],activeProjectId:null};
let currentChapterId=null, currentCharacterId=null, saveTimer=null, deferredPrompt=null;
const $=q=>q.startsWith('#')||q.startsWith('.')||q.includes(' ')?document.querySelector(q):document.getElementById(q);
const uid=()=>crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`;
const now=()=>new Date().toISOString();
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open(DB,VER);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE)};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function getDB(){const db=await openDB();return new Promise((res,rej)=>{const r=db.transaction(STORE).objectStore(STORE).get(KEY);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function setDB(v){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(v,KEY);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)})}
function project(){return state.projects.find(p=>p.id===state.activeProjectId)||null}
function normalizeProject(p){return {id:p.id||uid(),name:p.name||'โปรเจกต์ไม่มีชื่อ',createdAt:p.createdAt||now(),updatedAt:p.updatedAt||now(),documents:p.documents||[],canon:p.canon||[],characters:p.characters||[],timeline:p.timeline||[],chapters:p.chapters||[],issues:p.issues||[],dna:p.dna||null,activity:p.activity||[]}}
async function save(message='บันทึกแล้ว'){const p=project();if(p)p.updatedAt=now();$('saveState').textContent='กำลังบันทึก…';await setDB(state);$('saveState').textContent=message;renderAll()}
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1800)}
function activity(type,text){const p=project();if(!p)return;p.activity.unshift({id:uid(),type,text,at:now()});p.activity=p.activity.slice(0,30)}

function switchView(id){window.scrollTo({top:0,left:0,behavior:'instant'});document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id));document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===id));const labels={dashboard:['ภาพรวม','จัดการนิยายและตรวจความต่อเนื่อง'],documents:['คลังเอกสาร','นำเข้า PDF, DOCX และไฟล์ฐานข้อมูล'],canon:['Canon Database','ล็อกข้อเท็จจริงและกฎของเรื่อง'],characters:['ตัวละคร','สถานะ ความรู้ และความสัมพันธ์'],characterDetail:['ข้อมูลตัวละคร','ข้อมูลที่จัดหมวดหมู่จากฐานข้อมูล'],timeline:['Timeline','ลำดับเหตุการณ์ในเรื่อง'],editor:['เขียนบท','ตัวแก้ไขต้นฉบับพร้อมบันทึกอัตโนมัติ'],checker:['ตรวจความขัดแย้ง','ตรวจบทปัจจุบันกับฐานข้อมูล'],dna:['Writing DNA','วิเคราะห์รูปแบบการเขียน'],settings:['สำรองข้อมูล','ส่งออกและกู้คืนข้อมูลในเครื่อง']};const label=labels[id]||labels.dashboard;$('pageTitle').textContent=label[0];$('pageSubtitle').textContent=label[1];if(innerWidth<901)$('.sidebar').classList.remove('open')}

function openModal(title,html,onReady){$('modalTitle').textContent=title;$('modalBody').innerHTML=html;$('modal').hidden=false;onReady?.()}
function closeModal(){$('modal').hidden=true;$('modalBody').innerHTML=''}
document.querySelectorAll('[data-close]').forEach(x=>x.onclick=closeModal);

function ensureProject(){if(project())return true;toast('กรุณาสร้างโปรเจกต์ก่อน');return false}
function createProjectModal(){openModal('สร้างโปรเจกต์',`<div class="form-grid"><input id="mProjectName" placeholder="ชื่อเรื่อง"><textarea id="mProjectDesc" placeholder="คำอธิบายสั้น ๆ"></textarea><button id="mCreateProject" class="primary large">สร้างโปรเจกต์</button></div>`,()=>{$('mCreateProject').onclick=async()=>{const name=$('mProjectName').value.trim();if(!name)return toast('กรุณาใส่ชื่อโปรเจกต์');const p=normalizeProject({name,description:$('mProjectDesc').value.trim()});state.projects.push(p);state.activeProjectId=p.id;activity('project',`สร้างโปรเจกต์ ${name}`);closeModal();await save();toast('สร้างโปรเจกต์แล้ว')}})}

async function extractPdf(file){const pdfjs=await getPdfJs();const data=new Uint8Array(await file.arrayBuffer());const pdf=await pdfjs.getDocument({data, isEvalSupported:false}).promise;const pages=[];for(let n=1;n<=pdf.numPages;n++){$('importStatus').textContent=`กำลังอ่าน ${file.name} หน้า ${n}/${pdf.numPages}`;const page=await pdf.getPage(n);const c=await page.getTextContent();const text=c.items.map(i=>i.str).join(' ').replace(/\s+/g,' ').trim();pages.push({page:n,text})}return {text:pages.map(x=>`[หน้า ${x.page}]\n${x.text}`).join('\n\n'),pages,pageCount:pdf.numPages}}
async function extractDocx(file){const r=await window.mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()});return {text:r.value.trim(),warnings:r.messages.map(x=>x.message)}}
async function extractFile(file){const ext=file.name.split('.').pop().toLowerCase();if(['txt','md'].includes(ext))return {text:await file.text()};if(ext==='json'){const raw=await file.text();try{return {text:JSON.stringify(JSON.parse(raw),null,2)}}catch{return {text:raw}}}if(ext==='docx')return extractDocx(file);if(ext==='pdf')return extractPdf(file);throw new Error(`ยังไม่รองรับ .${ext}`)}

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
function cleanPdfText(text){
  return String(text||'')
    .replace(/\r/g,'\n').replace(/\f/g,'\n').replace(/\u00a0|\u200b/g,' ')
    .replace(/\[หน้า\s*\d+\]/g,'\n')
    .replace(/[━═─]{5,}/g,'\n')
    .replace(/[ \t]+/g,' ')
    .replace(/\n{3,}/g,'\n\n')
    .trim();
}
function cleanCharacterName(name){
  return String(name||'').replace(/^#{1,6}\s*/,'').replace(/^\d{1,3}[.)]\s*/,'')
    .replace(/^(?:ตัวละคร|CHARACTER)\s*(?:ที่|ลำดับ)?\s*\d*\s*[:：-]?\s*/i,'')
    .replace(/\s+/g,' ').trim();
}
function normalizeStatus(value){const v=String(value||'').trim();if(/เสียชีวิต|ตายแล้ว|dead/i.test(v))return'เสียชีวิต';if(/สูญหาย|หายตัว|missing/i.test(v))return'สูญหาย';if(/มีชีวิต|ยังคงมีชีวิต|alive/i.test(v))return'มีชีวิต';return v||'ไม่ทราบ'}
function cleanValue(value){return String(value||'').replace(/\[(?:CANON|LOCKED|INFERRED|CHAT)[^\]]*\]/gi,' ').replace(/[━═─]+/g,' ').replace(/\s+/g,' ').trim()}
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
function parsePartDatabase(text,sourceName){
  const t=cleanPdfText(text).replace(/\s+(?=PART\s*\d{1,3}\s*[:：])/gi,'\n');
  const re=/PART\s*(\d{1,3})\s*[:：]\s*([^\n]{2,120})/gi;const matches=[...t.matchAll(re)];const out=[];
  for(let i=0;i<matches.length;i++){
    const m=matches[i],name=cleanCharacterName(m[2].replace(/[━═─].*$/,'').trim());
    const block=t.slice(m.index+m[0].length,i+1<matches.length?matches[i+1].index:t.length);
    const item=buildCharacterFromPart(name,block,sourceName);
    if(item.name&&item.fieldCount>=2)out.push(item);
  }
  return out;
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
  let out=parsePartDatabase(text,sourceName);
  if(!out.length)out=parseStatusDatabase(text,sourceName);
  const merged=[];
  for(const item of out){
    if(!item.name||item.name.length>120)continue;
    const ex=merged.find(x=>normalizedName(x.name)===normalizedName(item.name));
    if(!ex){merged.push(item);continue}
    ex.aliases=[...new Set([...ex.aliases,...item.aliases])];ex.role=ex.role||item.role;ex.status=ex.status==='ไม่ทราบ'?item.status:ex.status;
    ex.facts=[...new Set([ex.facts,item.facts].filter(Boolean).join('\n').split('\n'))].join('\n');
    ex.limits=[...new Set([ex.limits,item.limits].filter(Boolean).join('\n').split('\n'))].join('\n');
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
  if(!ensureProject())return;const p=project();let added=0,updated=0,found=0,scanned=0;const docs=p.documents.filter(d=>d.text&&String(d.text).trim());
  for(const doc of docs){scanned++;const r=extractCharactersFromDocument(p,doc);added+=r.added;updated+=r.updated;found+=r.total}
  const box=$('characterExtractStatus');box.hidden=false;box.textContent=found?`ตรวจ ${scanned} เอกสาร · พบ ${found} รายการ · เพิ่มใหม่ ${added} ตัวละคร · อัปเดต ${updated} รายการ กรุณาตรวจทานข้อมูลที่สกัดอัตโนมัติ`:`ตรวจ ${scanned} เอกสารแล้ว แต่ยังไม่พบโครงสร้าง PART หรือระเบียนตัวละครที่รองรับ`;
  if(found){activity('character',`สกัดข้อมูลตัวละครจากเอกสาร เพิ่ม ${added} อัปเดต ${updated}`);await save();toast(`พบตัวละคร ${found} รายการ`)}else toast('ยังไม่พบข้อมูลตัวละครที่สกัดได้');
}

function canonModal(item=null){if(!ensureProject())return;openModal(item?'แก้ไข Canon':'เพิ่ม Canon',`<div class="form-grid"><div class="row2"><input id="mCanonTitle" placeholder="หัวข้อ"><select id="mCanonCategory"><option>ตัวละคร</option><option>ระบบ</option><option>พลัง</option><option>ไทม์ไลน์</option><option>สถานที่</option><option>ไอเทม</option><option>กฎโลก</option><option>อื่น ๆ</option></select></div><textarea id="mCanonRule" placeholder="ข้อความ Canon ที่ล็อกไว้"></textarea><textarea id="mCanonSource" placeholder="แหล่งอ้างอิง เช่น ชื่อไฟล์ > หัวข้อ > หน้า"></textarea><div class="row2"><select id="mCanonPriority"><option value="100">ผู้ใช้ล็อกเอง — สูงสุด</option><option value="80">Canon Database</option><option value="70">Character Bible</option><option value="60">Timeline</option><option value="40">ต้นฉบับตอน</option><option value="20">เอกสารอ้างอิง</option></select><button id="mSaveCanon" class="primary">บันทึก Canon</button></div></div>`,()=>{if(item){$('mCanonTitle').value=item.title;$('mCanonCategory').value=item.category;$('mCanonRule').value=item.rule;$('mCanonSource').value=item.source;$('mCanonPriority').value=String(item.priority||100)}$('mSaveCanon').onclick=async()=>{const rule=$('mCanonRule').value.trim();if(!rule)return toast('กรุณาใส่ข้อความ Canon');const p=project();const data={id:item?.id||uid(),title:$('mCanonTitle').value.trim()||'ไม่ระบุหัวข้อ',category:$('mCanonCategory').value,rule,source:$('mCanonSource').value.trim(),priority:Number($('mCanonPriority').value),locked:true,updatedAt:now()};if(item)Object.assign(p.canon.find(x=>x.id===item.id),data);else p.canon.push(data);activity('canon',`${item?'แก้ไข':'เพิ่ม'} Canon: ${data.title}`);closeModal();await save();toast('บันทึก Canon แล้ว')}})}

function characterModal(item=null){if(!ensureProject())return;openModal(item?'แก้ไขตัวละคร':'เพิ่มตัวละคร',`<div class="form-grid"><div class="row2"><input id="mCharName" placeholder="ชื่อตัวละคร"><select id="mCharStatus"><option>มีชีวิต</option><option>เสียชีวิต</option><option>สูญหาย</option><option>ไม่ทราบ</option></select></div><div class="row2"><input id="mCharRole" placeholder="บทบาท"><input id="mCharAliases" placeholder="ชื่อเรียกอื่น คั่นด้วยจุลภาค"></div><textarea id="mCharFacts" placeholder="ข้อเท็จจริงสำคัญ รูปลักษณ์ พลัง สิ่งที่รู้"></textarea><textarea id="mCharLimits" placeholder="ข้อจำกัดหรือสิ่งที่ห้ามขัด"></textarea><input id="mCharSource" placeholder="แหล่งอ้างอิง"><button id="mSaveChar" class="primary">บันทึกตัวละคร</button></div>`,()=>{if(item){$('mCharName').value=item.name;$('mCharStatus').value=item.status;$('mCharRole').value=item.role||'';$('mCharAliases').value=(item.aliases||[]).join(', ');$('mCharFacts').value=item.facts||'';$('mCharLimits').value=item.limits||'';$('mCharSource').value=item.source||''}$('mSaveChar').onclick=async()=>{const name=$('mCharName').value.trim();if(!name)return toast('กรุณาใส่ชื่อตัวละคร');const p=project();const data={id:item?.id||uid(),name,status:$('mCharStatus').value,role:$('mCharRole').value.trim(),aliases:$('mCharAliases').value.split(',').map(x=>x.trim()).filter(Boolean),facts:$('mCharFacts').value.trim(),limits:$('mCharLimits').value.trim(),source:$('mCharSource').value.trim(),updatedAt:now()};if(item)Object.assign(p.characters.find(x=>x.id===item.id),data);else p.characters.push(data);activity('character',`${item?'แก้ไข':'เพิ่ม'}ตัวละคร ${name}`);closeModal();await save();toast('บันทึกตัวละครแล้ว')}})}

function timelineModal(item=null){if(!ensureProject())return;openModal(item?'แก้ไขเหตุการณ์':'เพิ่มเหตุการณ์',`<div class="form-grid"><div class="row2"><input id="mTimeLabel" placeholder="เวลา เช่น Day 0 / 12 มี.ค."><input id="mTimeChapter" placeholder="ตอนที่ เช่น 31"></div><input id="mTimeTitle" placeholder="ชื่อเหตุการณ์"><textarea id="mTimeDetails" placeholder="รายละเอียด"></textarea><input id="mTimeSource" placeholder="แหล่งอ้างอิง"><button id="mSaveTime" class="primary">บันทึกเหตุการณ์</button></div>`,()=>{if(item){$('mTimeLabel').value=item.label||'';$('mTimeChapter').value=item.chapter||'';$('mTimeTitle').value=item.title;$('mTimeDetails').value=item.details||'';$('mTimeSource').value=item.source||''}$('mSaveTime').onclick=async()=>{const title=$('mTimeTitle').value.trim();if(!title)return toast('กรุณาใส่ชื่อเหตุการณ์');const p=project();const data={id:item?.id||uid(),label:$('mTimeLabel').value.trim(),chapter:$('mTimeChapter').value.trim(),title,details:$('mTimeDetails').value.trim(),source:$('mTimeSource').value.trim(),order:Number($('mTimeChapter').value)||999999,updatedAt:now()};if(item)Object.assign(p.timeline.find(x=>x.id===item.id),data);else p.timeline.push(data);activity('timeline',`${item?'แก้ไข':'เพิ่ม'} Timeline: ${title}`);closeModal();await save();toast('บันทึก Timeline แล้ว')}})}

function textStats(text){const clean=text.trim();return {chars:clean.length,words:(clean.match(/[\p{L}\p{N}]+/gu)||[]).length,paras:clean?clean.split(/\n\s*\n/).filter(x=>x.trim()).length:0,dialogues:(clean.match(/[“”"].+?[“”"]/g)||[]).length,sentences:(clean.split(/[.!?…]|[。！？]/).filter(x=>x.trim()).length)}}
function updateEditorStats(){const s=textStats($('chapterText').value);$('wordStats').textContent=`${s.chars.toLocaleString('th-TH')} ตัวอักษร · ${s.words.toLocaleString('th-TH')} คำ · ${s.paras} ย่อหน้า`}
function autosaveDraft(){clearTimeout(saveTimer);$('autosaveState').textContent='มีการแก้ไข';saveTimer=setTimeout(async()=>{if(!project())return;localStorage.setItem(`novel-draft-${project().id}`,JSON.stringify({id:currentChapterId,title:$('chapterTitle').value,text:$('chapterText').value,at:now()}));$('autosaveState').textContent='บันทึกร่างอัตโนมัติแล้ว'},650)}
function loadChapter(ch){currentChapterId=ch.id;$('chapterTitle').value=ch.title;$('chapterText').value=ch.text;updateEditorStats();$('autosaveState').textContent=`บันทึกล่าสุด ${new Date(ch.updatedAt).toLocaleString('th-TH')}`;switchView('editor')}

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

function renderAll(){renderProjectSelect();const p=project();$('heroProject').textContent=p?.name||'ยังไม่มีโปรเจกต์';renderDashboard(p);renderDocuments(p);renderCanon(p);renderCharacters(p);if(currentCharacterId)renderCharacterDetail(p?.characters.find(x=>x.id===currentCharacterId));renderTimeline(p);renderChapters(p);renderIssues(p);renderDNA(p)}
function renderProjectSelect(){const sel=$('activeProjectSelect');sel.innerHTML=state.projects.length?state.projects.map(p=>`<option value="${p.id}" ${p.id===state.activeProjectId?'selected':''}>${esc(p.name)}</option>`).join(''):'<option value="">ยังไม่มีโปรเจกต์</option>'}
function renderDashboard(p){const data=[['เอกสาร',p?.documents.length||0],['Canon',p?.canon.length||0],['ตัวละคร',p?.characters.length||0],['ตอน',p?.chapters.length||0]];$('stats').innerHTML=data.map(([n,v])=>`<div class="stat"><strong>${v.toLocaleString('th-TH')}</strong><span>${n}</span></div>`).join('');$('recentActivity').innerHTML=p?.activity.length?p.activity.slice(0,7).map(a=>`<div class="list-row"><div class="grow"><strong>${esc(a.text)}</strong><p>${new Date(a.at).toLocaleString('th-TH')}</p></div></div>`).join(''):'<div class="empty">ยังไม่มีกิจกรรม</div>';$('healthList').innerHTML=[['เอกสารฐานข้อมูล',p?.documents.length?'พร้อม':'ยังไม่มี'],['Canon ที่ล็อก',p?.canon.length?`${p.canon.length} รายการ`:'ยังไม่มี'],['ข้อมูลตัวละคร',p?.characters.length?`${p.characters.length} คน`:'ยังไม่มี'],['ไฟล์สำรอง','ควรสำรองเป็นระยะ']].map(([a,b])=>`<div class="health"><strong>${a}</strong><span>${b}</span></div>`).join('')}
function renderDocuments(p){const q=$('documentSearch').value.trim().toLowerCase();const docs=(p?.documents||[]).filter(d=>!q||d.name.toLowerCase().includes(q)||d.text.toLowerCase().includes(q));$('documentList').innerHTML=docs.length?docs.map(d=>`<article class="item-card"><div><span class="badge">${esc(d.type)}</span></div><h3>${esc(d.name)}</h3><div class="meta">${(d.text?.length||0).toLocaleString('th-TH')} ตัวอักษร${d.pageCount?` · ${d.pageCount} หน้า`:''} · ${new Date(d.createdAt).toLocaleString('th-TH')}</div><details><summary>ดูข้อความที่อ่านได้</summary><pre>${esc((d.text||'').slice(0,14000))}${d.text?.length>14000?'\n…ตัดการแสดงผล':''}</pre></details><div class="card-actions"><button data-doc-delete="${d.id}" class="danger outline">ลบ</button></div></article>`).join(''):'<div class="empty">ยังไม่มีเอกสาร</div>';document.querySelectorAll('[data-doc-delete]').forEach(b=>b.onclick=async()=>{if(confirm('ลบเอกสารนี้หรือไม่?')){p.documents=p.documents.filter(x=>x.id!==b.dataset.docDelete);await save()}})}
function renderCanon(p){const q=$('canonSearch').value.trim().toLowerCase(),f=$('canonFilter').value;const items=(p?.canon||[]).filter(c=>(!f||c.category===f)&&(!q||`${c.title} ${c.rule} ${c.source}`.toLowerCase().includes(q)));$('canonList').innerHTML=items.length?items.map(c=>`<article class="item-card"><span class="badge">${esc(c.category)}</span><h3>${esc(c.title)}</h3><p>${esc(c.rule)}</p><div class="meta">ลำดับความสำคัญ ${c.priority||100} · ${esc(c.source||'ไม่มีแหล่งอ้างอิง')}</div><div class="card-actions"><button data-canon-edit="${c.id}">แก้ไข</button><button data-canon-delete="${c.id}" class="danger outline">ลบ</button></div></article>`).join(''):'<div class="empty">ยังไม่มี Canon ที่ล็อก</div>';document.querySelectorAll('[data-canon-edit]').forEach(b=>b.onclick=()=>canonModal(p.canon.find(x=>x.id===b.dataset.canonEdit)));document.querySelectorAll('[data-canon-delete]').forEach(b=>b.onclick=async()=>{if(confirm('ลบ Canon นี้หรือไม่?')){p.canon=p.canon.filter(x=>x.id!==b.dataset.canonDelete);await save()}})}
function characterSections(c){
  const sections={...(c.structured||{})};
  const labels=['เผ่าพันธุ์','อายุ','บทบาท','สถานะ','วิถีหลัก','พรสวรรค์','บ้านเกิด','บ้านปัจจุบัน','ครอบครัว','ภูมิหลัง','ชีวิตวัยเด็ก','ชีวิตก่อนเริ่มเรื่อง','เหตุการณ์ก่อนเข้าหิมพานต์','แรงผลักดัน','ปมในใจ','จุดเด่น','จุดอ่อน','เส้นทางตัวละคร','ความสัมพันธ์สำคัญ','บทบาทในพล็อต','ข้อมูลเชื่อมจักรวาล','สถานะปัจจุบัน','บทบาทหลัก','เปิดตัว','Arc เด่น'];
  const facts=String(c.facts||'').replace(new RegExp(`\s+(?=(${labels.map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})\s*[:：])`,'g'),'\n');
  for(const line of facts.split(/\n+/)){
    const m=line.trim().match(/^([^:：]{1,45})[:：]\s*(.+)$/s);if(!m)continue;
    const key=m[1].trim(),value=m[2].trim();if(!value)continue;
    if(!sections[key])sections[key]=value;else if(!sections[key].includes(value))sections[key]+='\n'+value;
  }
  if(c.limits&&!sections['ข้อจำกัด'])sections['ข้อจำกัด']=c.limits;
  return sections;
}
function characterSummary(c){
  const s=characterSections(c);return s['เผ่าพันธุ์']||s['บทบาท']||c.role||'ยังไม่ระบุข้อมูลย่อ';
}
function renderCharacters(p){
  const chars=[...(p?.characters||[])].sort((a,b)=>a.name.localeCompare(b.name,'th'));
  $('characterList').className='character-directory';
  $('characterList').innerHTML=chars.length?chars.map(c=>`<article class="character-row" data-character-open="${c.id}"><div class="character-avatar">${esc((c.name||'?').trim().slice(0,1))}</div><div class="character-row-main"><div class="character-row-title"><h3>${esc(c.name)}</h3>${c.autoExtracted?'<span class="badge auto-badge">สกัดอัตโนมัติ</span>':''}</div><p>${esc(characterSummary(c))}</p><div class="character-tags"><span class="badge">${esc(c.status||'ไม่ทราบ')}</span>${c.role?`<span class="subtle-tag">${esc(c.role)}</span>`:''}</div></div><button class="view-character-btn" data-character-open="${c.id}">ดูข้อมูล</button></article>`).join(''):'<div class="empty">ยังไม่มีข้อมูลตัวละคร</div>';
  document.querySelectorAll('[data-character-open]').forEach(el=>el.onclick=e=>{e.stopPropagation();openCharacterDetail(el.dataset.characterOpen)});
}
function renderCharacterDetail(c){
  const host=$('characterDetailContent');if(!c){host.innerHTML='<div class="empty">ไม่พบข้อมูลตัวละคร</div>';return}
  const sections=characterSections(c);
  const order=['ข้อมูลพื้นฐาน','เผ่าพันธุ์','อายุ','บทบาท','สถานะ','วิถีหลัก','พรสวรรค์','บ้านเกิด','บ้านปัจจุบัน','ครอบครัว','ภูมิหลัง','ชีวิตวัยเด็ก','ชีวิตก่อนเริ่มเรื่อง','เหตุการณ์ก่อนเข้าหิมพานต์','แรงผลักดัน','ปมในใจ','จุดเด่น','จุดอ่อน','ข้อจำกัด','เส้นทางตัวละคร','ความสัมพันธ์สำคัญ','บทบาทในพล็อต','ข้อมูลเชื่อมจักรวาล','สถานะปัจจุบัน','บทบาทหลัก','เปิดตัว','Arc เด่น'];
  const basics=['เผ่าพันธุ์','อายุ','บทบาท','สถานะ','วิถีหลัก','พรสวรรค์','บ้านเกิด','บ้านปัจจุบัน'];
  const basicCards=basics.filter(k=>sections[k]).map(k=>`<div class="basic-fact"><span>${esc(k)}</span><strong>${esc(sections[k])}</strong></div>`).join('');
  const body=order.filter(k=>!basics.includes(k)&&sections[k]).map(k=>`<section class="character-info-section"><h3>${esc(k)}</h3><div class="formatted-character-text">${esc(sections[k]).replace(/\n/g,'<br>')}</div></section>`).join('');
  const extra=Object.entries(sections).filter(([k,v])=>!order.includes(k)&&v).map(([k,v])=>`<section class="character-info-section"><h3>${esc(k)}</h3><div class="formatted-character-text">${esc(v).replace(/\n/g,'<br>')}</div></section>`).join('');
  host.innerHTML=`<article class="character-profile-hero"><div class="character-profile-avatar">${esc((c.name||'?').trim().slice(0,1))}</div><div class="character-profile-heading"><div class="profile-badges"><span class="badge">${esc(c.status||'ไม่ทราบ')}</span>${c.autoExtracted?'<span class="badge auto-badge">สกัดอัตโนมัติ</span>':''}</div><h2>${esc(c.name)}</h2><p>${esc(c.role||'ยังไม่ระบุบทบาท')}</p>${c.aliases?.length?`<div class="aliases">ชื่อเรียกอื่น: ${esc(c.aliases.join(', '))}</div>`:''}</div></article>${basicCards?`<div class="basic-facts-grid">${basicCards}</div>`:''}<div class="character-sections-grid">${body||'<div class="empty">ยังไม่มีข้อมูลแบบจัดหมวดหมู่</div>'}${extra}</div>${c.source?`<div class="character-source-card"><strong>แหล่งข้อมูล</strong><p>${esc(c.source)}</p></div>`:''}`;
}
function openCharacterDetail(id){currentCharacterId=id;const c=project()?.characters.find(x=>x.id===id);renderCharacterDetail(c);switchView('characterDetail')}
function renderTimeline(p){const items=[...(p?.timeline||[])].sort((a,b)=>(a.order||999999)-(b.order||999999));$('timelineList').innerHTML=items.length?items.map(t=>`<article class="timeline-item"><span class="badge">${esc(t.label||'ไม่ระบุเวลา')}${t.chapter?` · ตอน ${esc(t.chapter)}`:''}</span><h3>${esc(t.title)}</h3><p>${esc(t.details||'')}</p><div class="meta">${esc(t.source||'ไม่มีแหล่งอ้างอิง')}</div><div class="card-actions"><button data-time-edit="${t.id}">แก้ไข</button><button data-time-delete="${t.id}" class="danger outline">ลบ</button></div></article>`).join(''):'<div class="empty">ยังไม่มี Timeline</div>';document.querySelectorAll('[data-time-edit]').forEach(b=>b.onclick=()=>timelineModal(p.timeline.find(x=>x.id===b.dataset.timeEdit)));document.querySelectorAll('[data-time-delete]').forEach(b=>b.onclick=async()=>{if(confirm('ลบเหตุการณ์นี้หรือไม่?')){p.timeline=p.timeline.filter(x=>x.id!==b.dataset.timeDelete);await save()}})}
function renderChapters(p){$('chapterList').innerHTML=p?.chapters.length?[...p.chapters].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(c=>`<div class="list-row"><div class="grow"><strong>${esc(c.title)}</strong><p>${textStats(c.text).chars.toLocaleString('th-TH')} ตัวอักษร · ${new Date(c.updatedAt).toLocaleString('th-TH')}</p></div><button data-chapter="${c.id}">เปิด</button></div>`).join(''):'<div class="empty">ยังไม่มีตอนที่บันทึก</div>';document.querySelectorAll('[data-chapter]').forEach(b=>b.onclick=()=>loadChapter(p.chapters.find(x=>x.id===b.dataset.chapter)))}
function renderIssues(p){const issues=p?.issues||[];const counts={high:0,medium:0,low:0};issues.forEach(i=>counts[i.severity]=(counts[i.severity]||0)+1);$('checkSummary').innerHTML=issues.length?`<div class="summary-grid"><div class="summary-box"><strong>${issues.length}</strong><span>รายการทั้งหมด</span></div><div class="summary-box"><strong>${counts.high}</strong><span>ระดับสูง</span></div><div class="summary-box"><strong>${counts.medium}</strong><span>ควรตรวจ</span></div><div class="summary-box"><strong>${counts.low}</strong><span>ผ่านเบื้องต้น</span></div></div>`:'ยังไม่มีผลตรวจ';$('issueList').innerHTML=issues.length?issues.map(i=>`<article class="issue ${i.severity}"><span class="badge">${esc(i.type)}</span><h3>${esc(i.title)}</h3>${i.excerpt?`<blockquote>${esc(i.excerpt)}</blockquote>`:''}<p><strong>หลักฐาน:</strong> ${esc(i.evidence)}</p><div class="meta">แหล่งอ้างอิง: ${esc(i.source)}</div><p><strong>ข้อเสนอ:</strong> ${esc(i.suggestion)}</p></article>`).join(''):'<div class="empty">กด “เริ่มตรวจบทปัจจุบัน” หลังใส่ต้นฉบับ</div>'}
function renderDNA(p){const d=p?.dna;if(!d){$('dnaStats').innerHTML=[['เอกสาร',0],['ตัวอักษร',0],['ย่อหน้า',0],['เฉลี่ย/ย่อหน้า',0]].map(([n,v])=>`<div class="stat"><strong>${v}</strong><span>${n}</span></div>`).join('');$('topWords').innerHTML='<div class="empty">ยังไม่ได้วิเคราะห์</div>';$('dnaNotes').innerHTML='<div class="empty">นำเข้าต้นฉบับหรือบันทึกตอนก่อน</div>';return}$('dnaStats').innerHTML=[['แหล่งข้อความ',d.documents],['ตัวอักษร',d.chars],['ย่อหน้า',d.paras],['เฉลี่ย/ย่อหน้า',d.avgParagraphChars]].map(([n,v])=>`<div class="stat"><strong>${Number(v).toLocaleString('th-TH')}</strong><span>${n}</span></div>`).join('');$('topWords').innerHTML=d.top.map(([w,n])=>`<span class="tag">${esc(w)} · ${n}</span>`).join('');const notes=[`ความยาวย่อหน้าเฉลี่ยประมาณ ${d.avgParagraphChars} ตัวอักษร`,`พบ ${d.sentences.toLocaleString('th-TH')} ช่วงประโยคจากข้อความทั้งหมด`,d.dialogueSignal>25?'มีสัญญาณการใช้บทสนทนาค่อนข้างมาก':'สัดส่วนบทสนทนาไม่สูงเมื่อเทียบกับคำบรรยาย',`วิเคราะห์ล่าสุด ${new Date(d.analyzedAt).toLocaleString('th-TH')}`];$('dnaNotes').innerHTML=notes.map(n=>`<div class="list-row"><div class="grow"><strong>${esc(n)}</strong></div></div>`).join('')}

$('menuBtn').onclick=()=>$('.sidebar').classList.toggle('open');
document.querySelectorAll('#nav button').forEach(b=>b.onclick=()=>switchView(b.dataset.view));document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>switchView(b.dataset.go));
$('newProjectBtn').onclick=createProjectModal;$('activeProjectSelect').onchange=async e=>{state.activeProjectId=e.target.value;currentChapterId=null;$('chapterTitle').value='';$('chapterText').value='';await save()};
$('openCanonModal').onclick=()=>canonModal();$('openCharacterModal').onclick=()=>characterModal();$('openTimelineModal').onclick=()=>timelineModal();
$('extractCharactersBtn').onclick=extractCharactersFromAllDocuments;
$('backToCharacters').onclick=()=>switchView('characters');
$('editCharacterDetail').onclick=()=>{const c=project()?.characters.find(x=>x.id===currentCharacterId);if(c)characterModal(c)};
$('deleteCharacterDetail').onclick=async()=>{const p=project(),c=p?.characters.find(x=>x.id===currentCharacterId);if(c&&confirm(`ลบตัวละคร “${c.name}” หรือไม่?`)){p.characters=p.characters.filter(x=>x.id!==currentCharacterId);currentCharacterId=null;await save();switchView('characters')}};
$('canonSearch').oninput=()=>renderCanon(project());$('canonFilter').onchange=()=>renderCanon(project());$('documentSearch').oninput=()=>renderDocuments(project());
$('documentInput').onchange=async e=>{
  if(!ensureProject())return;
  const files=[...e.target.files];
  const p=project();
  const type=$('documentType').value;
  let success=0;
  const failed=[];

  if(!files.length)return;
  $('documentInput').disabled=true;

  for(let i=0;i<files.length;i++){
    const f=files[i];
    $('importStatus').textContent=`กำลังนำเข้า ${i+1}/${files.length}: ${f.name}`;
    try{
      const parsed=await extractFile(f);
      const doc={
        id:uid(),
        name:f.name,
        type,
        text:parsed.text||'',
        pages:parsed.pages||null,
        pageCount:parsed.pageCount||null,
        warnings:parsed.warnings||[],
        size:f.size,
        createdAt:now()
      };
      p.documents.push(doc);
      if(['character','canon'].includes(type)){
        const extracted=extractCharactersFromDocument(p,doc);
        if(extracted.total){
          const box=$('characterExtractStatus');
          box.hidden=false;
          box.textContent=`จาก ${f.name}: พบ ${extracted.total} รายการ · เพิ่ม ${extracted.added} · อัปเดต ${extracted.updated} กรุณาตรวจทานข้อมูลที่สกัดอัตโนมัติ`;
        }
      }
      activity('document',`นำเข้าเอกสาร ${f.name}`);
      success++;
      // Persist each completed file so a later failure cannot erase earlier files.
      await setDB(state);
    }catch(err){
      failed.push(`${f.name}: ${err?.message||'อ่านไฟล์ไม่สำเร็จ'}`);
    }
    // Give Safari a chance to update the UI between large files.
    await new Promise(resolve=>setTimeout(resolve,0));
  }

  e.target.value='';
  $('documentInput').disabled=false;
  await save('บันทึกแล้ว');

  if(failed.length){
    $('importStatus').innerHTML=`นำเข้าสำเร็จ ${success} ไฟล์ · ไม่สำเร็จ ${failed.length} ไฟล์<br><small>${esc(failed.slice(0,8).join(' | '))}${failed.length>8?' …':''}</small>`;
    toast(`สำเร็จ ${success} ไฟล์ ไม่สำเร็จ ${failed.length} ไฟล์`);
  }else{
    $('importStatus').textContent=`นำเข้าสำเร็จ ${success} ไฟล์`;
    toast(`นำเข้าสำเร็จ ${success} ไฟล์`);
  }
};
$('chapterText').oninput=()=>{updateEditorStats();autosaveDraft()};$('chapterTitle').oninput=autosaveDraft;
$('newChapter').onclick=()=>{currentChapterId=null;$('chapterTitle').value='';$('chapterText').value='';updateEditorStats();$('autosaveState').textContent='บทใหม่'};
$('saveChapter').onclick=async()=>{if(!ensureProject())return;const p=project(),title=$('chapterTitle').value.trim()||'บทไม่มีชื่อ',text=$('chapterText').value;if(currentChapterId){const c=p.chapters.find(x=>x.id===currentChapterId);Object.assign(c,{title,text,updatedAt:now()})}else{const c={id:uid(),title,text,createdAt:now(),updatedAt:now()};p.chapters.push(c);currentChapterId=c.id}activity('chapter',`บันทึกตอน ${title}`);await save();$('autosaveState').textContent='บันทึกแล้ว';toast('บันทึกตอนแล้ว')};
$('runChecker').onclick=async()=>{if(!ensureProject())return;const text=$('chapterText').value.trim();if(!text)return toast('กรุณาใส่เนื้อหาบทก่อน');project().issues=checkChapter(text,project());activity('check',`ตรวจความขัดแย้ง ${project().issues.length} รายการ`);await save();switchView('checker');toast('ตรวจเสร็จแล้ว')};
$('analyzeDNA').onclick=analyzeDNA;
function download(obj,name){const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
$('exportBackup').onclick=()=>download(state,`novel-studio-backup-${new Date().toISOString().slice(0,10)}.noveldb.json`);$('exportProject').onclick=()=>{if(ensureProject())download(project(),`${project().name.replace(/[^\p{L}\p{N}_-]+/gu,'-')}.noveldb.json`)};
$('importBackup').onchange=async e=>{try{const x=JSON.parse(await e.target.files[0].text());if(!Array.isArray(x.projects))throw new Error('รูปแบบไฟล์ไม่ถูกต้อง');state={version:x.version||1,projects:x.projects.map(normalizeProject),activeProjectId:x.activeProjectId||x.projects[0]?.id||null};await save();toast('กู้คืนข้อมูลแล้ว')}catch(err){toast(err.message||'นำเข้าไม่สำเร็จ')}e.target.value=''};
$('deleteProject').onclick=async()=>{if(!ensureProject())return;if(confirm(`ลบโปรเจกต์ “${project().name}” หรือไม่?`)){state.projects=state.projects.filter(x=>x.id!==state.activeProjectId);state.activeProjectId=state.projects[0]?.id||null;await save();toast('ลบโปรเจกต์แล้ว')}};$('clearAll').onclick=async()=>{if(confirm('ล้างข้อมูลทุกโปรเจกต์หรือไม่? การกระทำนี้ย้อนกลับไม่ได้')){state={version:1,projects:[],activeProjectId:null};await save();toast('ล้างข้อมูลแล้ว')}};
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('installBtn').hidden=false});$('installBtn').onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('installBtn').hidden=true}};
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js');

history.scrollRestoration='manual';
(async()=>{window.scrollTo(0,0);const loaded=await getDB();if(loaded){state={version:loaded.version||1,projects:(loaded.projects||[]).map(normalizeProject),activeProjectId:loaded.activeProjectId||loaded.projects?.[0]?.id||null}}renderAll();updateEditorStats()})();
