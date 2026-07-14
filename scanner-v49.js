/*
 Novel Studio V49 Scanner
 - two-pass OCR for Thai prose (layout + sparse text)
 - conservative cleaning: preserve Thai sentences, remove only proven noise
 - metadata/status-bar filtering
 - line-level duplicate and cross-image overlap merging
 - no recursive cleanup
*/
(() => {
  'use strict';

  const PATCH_VERSION = '49';
  const $ = id => document.getElementById(id);

  const normalize = value => String(value || '')
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u200B-\u200D\u2060\uFEFF\u25CC\uFFFD]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();

  const comparable = value => normalize(value).toLocaleLowerCase('th').replace(/[^\p{L}\p{N}]+/gu, '');

  function similarity(a, b) {
    const x = comparable(a), y = comparable(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    const shorter = x.length <= y.length ? x : y;
    const longer = x.length > y.length ? x : y;
    if (longer.includes(shorter)) return shorter.length / longer.length;
    const grams = s => {
      const set = new Set();
      const n = s.length < 12 ? 2 : 3;
      for (let i = 0; i <= s.length - n; i++) set.add(s.slice(i, i + n));
      return set;
    };
    const gx = grams(x), gy = grams(y);
    let common = 0;
    gx.forEach(g => { if (gy.has(g)) common++; });
    return gx.size + gy.size ? (2 * common) / (gx.size + gy.size) : 0;
  }

  const meaningfulEnglishWords = new Set([
    'arc','canon','chapter','class','core','dark','database','death','demon','document','dragon','game','ghost','item','king','level','lord','magic','mana','master','mission','necropolis','page','quest','race','rank','raw','room','skill','soul','spirit','status','system','world','wraith','phantom','specter','undead','zombie','save','load','online','offline','project','version'
  ]);

  function meaningfulEnglish(text) {
    const words = String(text || '').match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || [];
    if (!words.length) return false;
    const valid = words.filter(w => meaningfulEnglishWords.has(w.toLowerCase()) || /^[A-Z][a-z]{2,}$/.test(w) || (w.length >= 4 && /[aeiou]/i.test(w)));
    return valid.length >= Math.max(1, Math.ceil(words.length * .7));
  }

  function isMetadata(line) {
    const s = normalize(line);
    if (!s) return false;
    return /^(?:https?:\/\/)?(?:www\.)?(?:writer\.dek-d\.com|dek-d\.com|github\.com|maxsukung\.github\.io)\/?$/i.test(s)
      || /^(?:IMG[_-]?\d+\.(?:png|jpe?g|webp)|.+\.pdf)$/i.test(s)
      || /^={3,}.*(?:IMG[_-]?\d+|\.pdf).*={3,}$/i.test(s)
      || /^(?:หน้า|page)\s*\d+(?:\s*\/\s*\d+)?$/i.test(s)
      || /^\d{1,2}:\d{2}\b.*(?:\d{1,3}%|wifi|5g|4g|lte|จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์)/i.test(s)
      || /^(?:จันทร์|อังคาร|พุธ|พฤหัสบดี|ศุกร์|เสาร์|อาทิตย์)\s+\d{1,2}\s+(?:ม\.|ก\.|พ\.|ส\.|ต\.|ธ\.|เม\.|มิ\.)/i.test(s)
      || /^\d{1,2}\s+(?:ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s+\d{2,4}.*(?:ตัวอักษร|หน้า|K\b|KB\b)/i.test(s)
      || /^(?:ข้อความสะอาด|ข้อความดิบ|คัดลอกข้อความ(?:สะอาด)?|ล้างข้อความ)$/i.test(s)
      || /^\[อ่าน .* ไม่สำเร็จ:.*\]$/i.test(s);
  }

  function stats(s) {
    return {
      thai: (s.match(/[\u0E01-\u0E5B]/g) || []).length,
      latin: (s.match(/[A-Za-z]/g) || []).length,
      digits: (s.match(/[0-9๐-๙]/g) || []).length,
      junk: (s.match(/[^\p{L}\p{N}\s“”"'‘’.,!?…ฯๆ()\-–—:;\/#]/gu) || []).length,
      len: [...s].length || 1
    };
  }

  function fragmentIsNoise(fragment) {
    const s = normalize(fragment);
    if (!s) return true;
    const x = stats(s);
    if (x.thai >= 5) return false;
    if (meaningfulEnglish(s)) return false;
    if (/^[A-Za-z]{1,3}$/.test(s)) return true;
    if (/^(?:o|wo|nw|vv|vo|dur|moro|ade|aaa|ne)(?:\s|$)/i.test(s)) return true;
    if (x.digits >= 2 && x.thai === 0) return true;
    if ((x.latin + x.digits + x.junk) / x.len > .65) return true;
    return false;
  }

  function removeNoiseFragments(line) {
    let s = normalize(line);
    if (!s) return '';

    s = s.replace(/\b(?:writer\.dek-d\.com|dek-d\.com|maxsukung\.github\.io)\b/gi, ' ');
    s = s.replace(/\s+[A-Za-z0-9๐-๙@=<>«»£¥€$&%.,:+\-_/\\]{1,}(?:\s+[A-Za-z0-9๐-๙@=<>«»£¥€$&%.,:+\-_/\\]{1,}){2,}\s*$/g, m => fragmentIsNoise(m) ? '' : m);
    s = s.replace(/^[A-Za-z0-9๐-๙@=<>«»£¥€$&%.,:+\-_/\\]{1,}(?:\s+[A-Za-z0-9๐-๙@=<>«»£¥€$&%.,:+\-_/\\]{1,}){2,}\s+/g, m => fragmentIsNoise(m) ? '' : m);
    s = s.replace(/(?:^|\s)(?:o\s*๓\s*-?\s*A\s*๓\s*Ade\s*a|97(?:\s+[๐-๙0-9A-Za-z!r=]+){2,}|ooo?\S*\s+aaa|ne(?:\s+\S+){2,}|nw(?:\s+\S+){2,})(?=\s|$)/gi, ' ');
    s = s.replace(/\s+([,.!?;:…])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
    return s;
  }

  function cleanLine(line) {
    let s = removeNoiseFragments(line);
    if (!s || isMetadata(s)) return '';
    const x = stats(s);
    if (x.thai === 0 && x.latin > 0 && !meaningfulEnglish(s)) return '';
    if (x.thai < 3 && !meaningfulEnglish(s) && (x.digits + x.latin + x.junk) / x.len > .45) return '';
    if (x.junk / x.len > .2 && x.thai < 8) return '';
    if (/^[\d๐-๙\s@%()[\]{}=<>«»£¥€$&.,:;!?+\-_/\\]{4,}$/.test(s)) return '';
    return s;
  }

  function lineQuality(line) {
    const s = normalize(line), x = stats(s);
    let score = x.thai * 3 + Math.min(x.latin, 20) - x.junk * 8;
    if (/[ก-ฮ][่้๊๋์ัิีึืุู็]/.test(s)) score += 8;
    if (/[.!?…ฯ”’]$/.test(s)) score += 3;
    if (isMetadata(s)) score -= 100;
    return score;
  }

  function mergePasses(primary, secondary) {
    const a = normalize(primary).replace(/\r/g, '').split('\n').map(normalize).filter(Boolean);
    const b = normalize(secondary).replace(/\r/g, '').split('\n').map(normalize).filter(Boolean);
    const used = new Set();
    const out = [];
    for (const line of a) {
      let best = -1, bestScore = 0;
      for (let i = 0; i < b.length; i++) {
        if (used.has(i)) continue;
        const sim = similarity(line, b[i]);
        if (sim > bestScore) { bestScore = sim; best = i; }
      }
      if (best >= 0 && bestScore >= .56) {
        used.add(best);
        out.push(lineQuality(b[best]) > lineQuality(line) ? b[best] : line);
      } else out.push(line);
    }
    for (let i = 0; i < b.length; i++) if (!used.has(i) && lineQuality(b[i]) >= 12) out.push(b[i]);
    return out.join('\n');
  }

  function cleanOcrText(raw) {
    const sourceLines = normalize(String(raw || '').replace(/\r\n?/g, '\n')).split('\n');
    const lines = [];
    for (const original of sourceLines) {
      const clean = cleanLine(original);
      if (!clean) {
        if (lines.length && lines.at(-1) !== '') lines.push('');
        continue;
      }
      const duplicate = lines.slice(-5).some(prev => prev && similarity(prev, clean) >= .975);
      if (!duplicate) lines.push(clean);
    }
    while (lines[0] === '') lines.shift();
    while (lines.at(-1) === '') lines.pop();

    const paragraphs = [];
    let buffer = [];
    const flush = () => {
      if (!buffer.length) return;
      const text = buffer.join(' ').replace(/\s+([,.!?;:…])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
      if (text && !paragraphs.some(p => similarity(p, text) >= .975)) paragraphs.push(text);
      buffer = [];
    };
    for (const line of lines) {
      if (!line) { flush(); continue; }
      const standalone = /^(?:ตอนที่|บทที่|ภาคที่|ARC\b|CHAPTER\b)/i.test(line) || /^[“"'‘]/.test(line) || /^[-—–_─━═]{3,}$/.test(line);
      if (standalone) { flush(); paragraphs.push(line); continue; }
      buffer.push(line);
      if (/[.!?…ฯ”’]$/.test(line)) flush();
    }
    flush();
    return paragraphs.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  async function imageFromSource(source) {
    if (source instanceof HTMLCanvasElement) return source;
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = source;
    });
  }

  async function makeCanvases(source) {
    const img = await imageFromSource(source);
    const width = img.width || img.naturalWidth;
    const height = img.height || img.naturalHeight;
    const screenshot = height > width * 1.15 && height > 900;
    const top = screenshot ? Math.round(height * .045) : 0;
    const bottom = screenshot ? Math.round(height * .006) : 0;
    const cropH = height - top - bottom;
    const scale = Math.min(2.15, Math.max(1.35, 2100 / Math.max(width, 1)));

    const original = document.createElement('canvas');
    original.width = Math.round(width * scale);
    original.height = Math.round(cropH * scale);
    const octx = original.getContext('2d', { willReadFrequently: true });
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(img, 0, top, width, cropH, 0, 0, original.width, original.height);

    const contrast = document.createElement('canvas');
    contrast.width = original.width; contrast.height = original.height;
    const cctx = contrast.getContext('2d', { willReadFrequently: true });
    cctx.drawImage(original, 0, 0);
    const imageData = cctx.getImageData(0, 0, contrast.width, contrast.height);
    for (let i = 0; i < imageData.data.length; i += 4) {
      const g = imageData.data[i] * .299 + imageData.data[i+1] * .587 + imageData.data[i+2] * .114;
      const v = Math.max(0, Math.min(255, (g - 128) * 1.18 + 128));
      imageData.data[i] = imageData.data[i+1] = imageData.data[i+2] = v;
    }
    cctx.putImageData(imageData, 0, 0);
    return { original, contrast };
  }

  async function recognize(canvas, label, pass, psm) {
    const status = $('scannerStatus');
    const result = await window.Tesseract.recognize(canvas, 'tha+eng', {
      logger(m) {
        if (status && typeof m.progress === 'number') status.textContent = `${label} · ${pass} ${Math.round(m.progress * 100)}%`;
      }
    }, { preserve_interword_spaces: '1', tessedit_pageseg_mode: String(psm), user_defined_dpi: '300' });
    return normalize(result?.data?.text || '');
  }

  async function recognizeImage(source, label) {
    if (!window.Tesseract) throw new Error('ยังโหลด OCR ไม่สำเร็จ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่');
    const status = $('scannerStatus');
    if (status) { status.hidden = false; status.textContent = `กำลังเตรียม ${label}…`; }
    const { original, contrast } = await makeCanvases(source);
    const first = await recognize(contrast, label, 'อ่านเนื้อหา', 6);
    const second = await recognize(original, label, 'ตรวจวรรณยุกต์', 4);
    return mergePasses(first, second);
  }

  async function getPdfJs() {
    const lib = await import('./pdf.legacy.min.mjs?v=49');
    lib.GlobalWorkerOptions.workerSrc = './pdf.legacy.worker.min.mjs';
    return lib;
  }

  async function scanPdf(file) {
    const pdfjs = await getPdfJs();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const native = normalize((content.items || []).map(item => item.str || '').join(' '));
      if (native.length >= 100) { pages.push(native); continue; }
      const viewport = page.getViewport({ scale: 1.8 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      pages.push(await recognizeImage(canvas, `PDF หน้า ${i}/${pdf.numPages}`));
    }
    return pages.join('\n\n');
  }

  function mergeBlocks(blocks) {
    const merged = [];
    for (const block of blocks.map(cleanOcrText).filter(Boolean)) {
      const next = block.split(/\n{2,}/).filter(Boolean);
      if (!merged.length) { merged.push(...next); continue; }
      let overlap = 0;
      const max = Math.min(10, merged.length, next.length);
      for (let n = max; n >= 1; n--) {
        const tail = merged.slice(-n).join(' '), head = next.slice(0, n).join(' ');
        if (similarity(tail, head) >= .93) { overlap = n; break; }
      }
      for (const paragraph of next.slice(overlap)) {
        if (!merged.slice(-12).some(prev => similarity(prev, paragraph) >= .97)) merged.push(paragraph);
      }
    }
    return merged.join('\n\n').trim();
  }

  function fileOrder(file) {
    const match = String(file.name || '').match(/(\d+)(?!.*\d)/);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  }

  async function handleFiles(files) {
    const status = $('scannerStatus'), preview = $('scannerPreview');
    const cleanOutput = $('scannerText'), rawOutput = $('scannerRawText');
    if (!cleanOutput || !rawOutput) return;
    if (status) { status.hidden = false; status.textContent = 'กำลังเตรียมไฟล์…'; }
    if (preview) preview.innerHTML = '';
    const ordered = [...files].sort((a,b) => fileOrder(a)-fileOrder(b) || a.name.localeCompare(b.name,'th'));
    const rawBlocks = [], failures = [];
    for (const file of ordered) {
      try {
        if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) rawBlocks.push(await scanPdf(file));
        else if (file.type.startsWith('image/')) {
          const url = URL.createObjectURL(file);
          try {
            if (preview) {
              const card = document.createElement('div'); card.className = 'scanner-preview-item';
              const image = document.createElement('img'); image.src = url; image.alt = file.name;
              const caption = document.createElement('div'); caption.textContent = file.name;
              card.append(image, caption); preview.appendChild(card);
            }
            rawBlocks.push(await recognizeImage(url, file.name));
          } finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
        }
      } catch (error) { failures.push(`${file.name}: ${error?.message || error}`); }
    }
    rawOutput.value = rawBlocks.filter(Boolean).join('\n\n');
    cleanOutput.value = mergeBlocks(rawBlocks);
    cleanOutput.hidden = false; rawOutput.hidden = true;
    $('showScannerClean')?.classList.add('primary'); $('showScannerRaw')?.classList.remove('primary');
    if (status) status.textContent = failures.length ? `อ่านสำเร็จ ${ordered.length-failures.length}/${ordered.length} ไฟล์ · ผิดพลาด ${failures.length} ไฟล์` : `อ่านเสร็จแล้ว ${ordered.length} ไฟล์ · V49 รวมข้อความและกรอง OCR แล้ว`;
    if (failures.length) console.warn('[Novel Studio V49 OCR failures]', failures);
  }

  function install() {
    const badge = $('appVersionBadge'); if (badge) badge.textContent = 'V49';
    const input = $('scannerInput');
    if (input) input.onchange = async event => { const files = [...(event.target.files || [])]; try { if (files.length) await handleFiles(files); } finally { event.target.value = ''; } };
    const cleanButton = $('showScannerClean');
    if (cleanButton) cleanButton.onclick = () => { const raw = $('scannerRawText')?.value || ''; if ($('scannerText') && raw) $('scannerText').value = cleanOcrText(raw); $('scannerText').hidden = false; $('scannerRawText').hidden = true; cleanButton.classList.add('primary'); $('showScannerRaw')?.classList.remove('primary'); };
    const rawButton = $('showScannerRaw');
    if (rawButton) rawButton.onclick = () => { $('scannerText').hidden = true; $('scannerRawText').hidden = false; rawButton.classList.add('primary'); cleanButton?.classList.remove('primary'); };
    window.NovelStudioScannerV49 = { version: PATCH_VERSION, cleanOcrText, mergeBlocks, handleFiles };
    console.info('Novel Studio Scanner V49 installed');
  }

  if (document.readyState === 'complete') setTimeout(install, 0);
  else window.addEventListener('load', install, { once: true });
})();
