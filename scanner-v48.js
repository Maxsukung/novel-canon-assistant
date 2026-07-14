
/*
 Novel Studio V48 Scanner Patch
 - OCR single-pass pipeline
 - no recursion / no repeated clean-merge loop
 - preserves Thai combining marks
 - removes screenshot chrome/status-bar noise
 - keeps meaningful English
 - exact + near-duplicate paragraph merging
*/
(() => {
  'use strict';

  const PATCH_VERSION = '48';
  const $ = (id) => document.getElementById(id);

  function setVersionBadge() {
    const badge = $('appVersionBadge');
    if (badge) badge.textContent = `V${PATCH_VERSION}`;
  }

  function toast(message) {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    window.setTimeout(() => el.classList.remove('show'), 2200);
  }

  function normalizeThai(text) {
    return String(text || '')
      .normalize('NFC')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
      .replace(/\uFFFD|\u25CC/g, '');
  }

  function meaningfulEnglish(line) {
    const words = String(line || '').match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || [];
    if (!words.length) return false;

    const common = new Set([
      'a','an','and','are','as','at','be','but','by','can','chapter','class',
      'core','dark','database','death','demon','document','dragon','for','from',
      'game','ghost','good','hello','i','in','is','it','item','king','level',
      'load','lord','magic','mana','master','mission','necropolis','no','not',
      'of','on','or','page','quest','race','rank','raw','room','save','skill',
      'soul','spirit','status','system','thank','the','to','up','wake','with',
      'world','you','your','arc','canon'
    ]);

    const valid = words.filter(word => {
      const lower = word.toLowerCase();
      return common.has(lower) ||
        /^[A-Z][a-z]{2,}$/.test(word) ||
        (word.length >= 3 && /[aeiouy]/i.test(word) && !/^(?:wo|dur|vv|vo|moro|nw)$/i.test(word));
    });

    return words.length === 1 ? valid.length === 1 : valid.length >= Math.ceil(words.length * 0.67);
  }

  function isHeaderNoise(line) {
    const s = String(line || '').trim();
    if (!s) return false;

    if (/^(?:https?:\/\/)?(?:www\.)?(?:writer\.dek-d\.com|dek-d\.com|github\.com|maxsukung\.github\.io)\/?$/i.test(s)) return true;
    if (/^(?:IMG[_-]?\d+\.(?:png|jpe?g|webp)|.+\.pdf)$/i.test(s)) return true;
    if (/^={3,}.*(?:IMG[_-]?\d+|\.pdf).*={3,}$/i.test(s)) return true;
    if (/^(?:หน้า|page)\s*\d+(?:\s*\/\s*\d+)?$/i.test(s)) return true;
    if (/^\d{1,2}:\d{2}\b/.test(s) && /(?:จันทร์|อังคาร|พุธ|พฤหัสบดี|ศุกร์|เสาร์|อาทิตย์|\d{1,3}%|wifi|5g|4g|lte)/i.test(s)) return true;
    if (/^(?:จันทร์|อังคาร|พุธ|พฤหัสบดี|ศุกร์|เสาร์|อาทิตย์)\s+\d{1,2}\s+.*$/i.test(s)) return true;
    if (/^(?:จันทร์|อังคาร|พุธ|พฤหัสบดี|ศุกร์|เสาร์|อาทิตย์)(?:\s+\d{1,2})?(?:\s+[^\n]{0,20})?$/i.test(s)) return true;
    if (/^ลำดับตอนที่\s*#?\d+\s*[:：]/i.test(s)) return true;
    if (/^\d{1,2}\s+(?:ม\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.|ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.)\s+\d{2,4}.*(?:ตัวอักษร|หน้า\s*A?\d+)/i.test(s)) return true;
    if (/^\d{1,2}\s+(?:ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s+\d{2,4}/.test(s)) return true;
    if (/^(?:ข้อความสะอาด|ข้อความดิบ|คัดลอกข้อความ(?:สะอาด)?|ล้างข้อความ)$/i.test(s)) return true;
    if (/^\[อ่าน .* ไม่สำเร็จ:.*\]$/i.test(s)) return true;
    return false;
  }

  function isGarbage(line) {
    const s = String(line || '').trim();
    if (!s) return false;
    if (isHeaderNoise(s)) return true;
    if (/^[A-Za-z]$/.test(s)) return true;
    if (/^(?:o\s*wo|wo\s*o|o\s+wo\s*=\s*a\s*wo)/i.test(s)) return true;
    if (/^(?:moro|nw|vv|vo|dur)$/i.test(s)) return true;
    if (/^[\d๐-๙\s@%()[\]{}=<>«»£¥€$&.,:;!?+\-_/\\]{5,}$/.test(s)) return true;

    const thai = (s.match(/[\u0E00-\u0E7F]/g) || []).length;
    const latin = (s.match(/[A-Za-z]/g) || []).length;
    const digits = (s.match(/[\d๐-๙]/g) || []).length;
    const odd = (s.match(/[^\p{L}\p{N}\s“”"'‘’.,!?…ฯๆ()\-–—:/#]/gu) || []).length;
    const length = [...s].length || 1;

    if (thai === 0 && latin > 0 && !meaningfulEnglish(s)) {
      if (latin <= 3 || odd / length > 0.08 || digits / length > 0.25) return true;
    }
    if (odd / length > 0.22) return true;
    // Mixed OCR fragments: short Latin/number clusters embedded in otherwise Thai prose.
    const mixedTokens = s.match(/(?:[A-Za-z0-9๐-๙][A-Za-z0-9๐-๙=<>«»£¥€$&@%.,:+\-]{1,})/g) || [];
    if (thai > 0 && mixedTokens.some(t => t.length >= 5 && !meaningfulEnglish(t))) return true;
    if (/^(?:ne|nw|wo|vv|vo|dur|moro)(?:\s+|$)/i.test(s)) return true;
    return false;
  }

  function cleanInline(text) {
    let s = normalizeThai(text);

    s = s
      .replace(/\b(?:writer\.dek-d\.com|dek-d\.com|maxsukung\.github\.io)\b/gi, ' ')
      .replace(/(?:^|\s)(?:moro|nw|vv|vo|dur)(?=\s|$)/gi, ' ')
      .replace(/(?:^|\s)(?:7\s*J|J\s*7|J)(?=\s|$)/g, ' ')
      .replace(/(?:^|\s)(?:ne|nw|wo|vv|vo|dur|moro)(?:\s+[A-Za-z0-9๐-๙=<>«»£¥€$&@%.,:+\-]{1,6}){0,8}(?=\s|$)/gi, ' ')
      .replace(/(?:^|\s)(?:[A-Za-z0-9๐-๙]{1,3}\s+){3,}[A-Za-z0-9๐-๙]{0,3}(?=\s|$)/g, ' ')
      .replace(/(?:^|\s)[A-Za-z]{2,}(?:\s+[A-Za-z0-9=<>«»£¥€$&@%.,:+\-]{1,5}){2,}(?=\s|$)/g, m => meaningfulEnglish(m) ? m : ' ')
      .replace(/(?:^|\s)[@©®]?\s*(?:\d{1,3}%|[๐-๙]{1,3}%)(?:\s*[()๐-๙A-Za-z@©®=:+-]*)?(?=\s|$)/g, ' ')
      .replace(/(?:^|\s)(?:[๐-๙0-9]{1,3}\s+){3,}[A-Za-z]?\s*(?=\s|$)/g, ' ')
      .replace(/(?:^|\s)[\[({]?[=<>YV\d๐-๙£¥€$&@%.,:+\-\s]{6,}[\])}]?(?=\s|$)/g, ' ')
      .replace(/\s+([,.!?;:…])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    if (isGarbage(s)) return '';
    return s;
  }

  function comparable(text) {
    return normalizeThai(text)
      .toLocaleLowerCase('th')
      .replace(/[^\p{L}\p{N}]+/gu, '');
  }

  function similarity(a, b) {
    const x = comparable(a);
    const y = comparable(b);
    if (!x || !y) return 0;
    if (x === y) return 1;

    const shorter = x.length <= y.length ? x : y;
    const longer = x.length > y.length ? x : y;
    if (longer.includes(shorter) && shorter.length / longer.length >= 0.84) {
      return shorter.length / longer.length;
    }

    const grams = value => {
      const out = new Set();
      for (let i = 0; i < value.length - 2; i += 1) out.add(value.slice(i, i + 3));
      return out;
    };
    const gx = grams(x);
    const gy = grams(y);
    if (!gx.size || !gy.size) return 0;

    let common = 0;
    gx.forEach(g => { if (gy.has(g)) common += 1; });
    return (2 * common) / (gx.size + gy.size);
  }

  function dedupeParagraphs(paragraphs) {
    const result = [];
    for (const paragraph of paragraphs) {
      const clean = paragraph.trim();
      if (!clean) continue;

      const duplicateIndex = result.findIndex(prev => similarity(prev, clean) >= 0.94);
      if (duplicateIndex === -1) {
        result.push(clean);
      } else if (clean.length > result[duplicateIndex].length) {
        result[duplicateIndex] = clean;
      }
    }
    return result;
  }

  function cleanOcrText(raw) {
    const source = normalizeThai(raw).replace(/\r\n?/g, '\n');
    const lines = [];
    let lastComparable = '';

    for (const originalLine of source.split('\n')) {
      const line = cleanInline(originalLine);
      if (!line) {
        if (lines.length && lines[lines.length - 1] !== '') lines.push('');
        continue;
      }

      const key = comparable(line);
      if (key && key === lastComparable) continue;
      lines.push(line);
      lastComparable = key;
    }

    while (lines[0] === '') lines.shift();
    while (lines[lines.length - 1] === '') lines.pop();

    const paragraphs = [];
    let buffer = [];

    const flush = () => {
      if (!buffer.length) return;
      const joined = buffer.join(' ')
        .replace(/\s+([,.!?;:…])/g, '$1')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
      if (joined) paragraphs.push(joined);
      buffer = [];
    };

    for (const line of lines) {
      if (!line) {
        flush();
        continue;
      }

      const heading = /^(?:บทที่|ตอนที่|ภาคที่|ARC\b|CHAPTER\b)/i.test(line);
      const dialogue = /^[“"'‘]/.test(line);
      const divider = /^[-—–_─━═]{3,}$/.test(line);

      if (divider) {
        flush();
        if (paragraphs[paragraphs.length - 1] !== '──────────') paragraphs.push('──────────');
        continue;
      }

      if (heading || dialogue) {
        flush();
        paragraphs.push(line);
        continue;
      }

      buffer.push(line);
      if (/[.!?…ฯ”"'’]$/.test(line)) flush();
    }
    flush();

    return dedupeParagraphs(paragraphs).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
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

  function detectCrop(img) {
    const width = img.width || img.naturalWidth;
    const height = img.height || img.naturalHeight;

    // Screenshot-sized images often contain browser/status chrome.
    // Crop only a conservative top band; prose remains intact.
    const portraitScreenshot = height > width * 1.15 && height >= 900;
    const top = portraitScreenshot ? Math.round(height * 0.055) : 0;
    const bottom = portraitScreenshot ? Math.round(height * 0.008) : 0;

    return { x: 0, y: top, width, height: Math.max(1, height - top - bottom) };
  }

  async function prepareImage(source) {
    const img = await imageFromSource(source);
    const crop = detectCrop(img);
    const scale = Math.min(2.2, Math.max(1.25, 2200 / Math.max(crop.width, 1)));

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(crop.width * scale);
    canvas.height = Math.round(crop.height * scale);

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      img,
      crop.x, crop.y, crop.width, crop.height,
      0, 0, canvas.width, canvas.height
    );

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Grayscale + mild contrast. Avoid aggressive thresholding that erases Thai marks.
    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.28 + 128));
      data[i] = contrasted;
      data[i + 1] = contrasted;
      data[i + 2] = contrasted;
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  async function recognizeImage(source, label) {
    if (!window.Tesseract) {
      throw new Error('ยังโหลด OCR ไม่สำเร็จ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่');
    }

    const status = $('scannerStatus');
    if (status) {
      status.hidden = false;
      status.textContent = `กำลังอ่านข้อความจาก ${label}…`;
    }

    const canvas = await prepareImage(source);
    const result = await window.Tesseract.recognize(
      canvas,
      'tha+eng',
      {
        logger(message) {
          if (!status || typeof message.progress !== 'number') return;
          status.textContent = `${label}: ${message.status} ${Math.round(message.progress * 100)}%`;
        }
      },
      {
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: '6',
        user_defined_dpi: '300'
      }
    );

    return normalizeThai(result?.data?.text || '').trim();
  }

  async function getPdfJs() {
    const lib = await import('./pdf.legacy.min.mjs?v=48');
    lib.GlobalWorkerOptions.workerSrc = './pdf.legacy.worker.min.mjs';
    return lib;
  }

  async function scanPdf(file) {
    const pdfjs = await getPdfJs();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data: bytes }).promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const nativeText = normalizeThai(
        (content.items || []).map(item => item.str || '').join(' ')
      ).replace(/[ \t]{2,}/g, ' ').trim();

      if (nativeText.length >= 80) {
        pages.push(nativeText);
        continue;
      }

      const viewport = page.getViewport({ scale: 1.75 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      pages.push(await recognizeImage(canvas, `PDF หน้า ${pageNumber}/${pdf.numPages}`));
    }

    return pages.join('\n\n');
  }

  function fileOrder(file) {
    const match = String(file.name || '').match(/(\d+)(?!.*\d)/);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  }

  async function handleFiles(files) {
    const status = $('scannerStatus');
    const preview = $('scannerPreview');
    const cleanOutput = $('scannerText');
    const rawOutput = $('scannerRawText');

    if (!cleanOutput || !rawOutput) return;
    if (status) {
      status.hidden = false;
      status.textContent = 'กำลังเตรียมไฟล์…';
    }
    if (preview) preview.innerHTML = '';

    const ordered = [...files].sort((a, b) =>
      fileOrder(a) - fileOrder(b) || a.name.localeCompare(b.name, 'th')
    );

    const rawBlocks = [];
    const failures = [];

    for (const file of ordered) {
      try {
        if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
          rawBlocks.push(await scanPdf(file));
        } else if (file.type.startsWith('image/')) {
          const url = URL.createObjectURL(file);
          try {
            if (preview) {
              const card = document.createElement('div');
              card.className = 'scanner-preview-item';
              const image = document.createElement('img');
              image.src = url;
              image.alt = file.name;
              const caption = document.createElement('div');
              caption.textContent = file.name;
              card.append(image, caption);
              preview.appendChild(card);
            }
            rawBlocks.push(await recognizeImage(url, file.name));
          } finally {
            window.setTimeout(() => URL.revokeObjectURL(url), 60000);
          }
        }
      } catch (error) {
        failures.push(`${file.name}: ${error?.message || error}`);
      }
    }

    const raw = rawBlocks.filter(Boolean).join('\n\n');
    rawOutput.value = raw;
    const cleanedBlocks = rawBlocks.map(cleanOcrText).filter(Boolean);
    const merged = [];
    for (const block of cleanedBlocks) {
      if (!merged.length) { merged.push(block); continue; }
      const previous = merged[merged.length - 1];
      const prevParas = previous.split(/\n{2,}/).filter(Boolean);
      const nextParas = block.split(/\n{2,}/).filter(Boolean);
      let overlap = 0;
      const max = Math.min(8, prevParas.length, nextParas.length);
      for (let n = max; n >= 1; n -= 1) {
        const tail = prevParas.slice(-n).join(' ');
        const head = nextParas.slice(0, n).join(' ');
        if (similarity(tail, head) >= 0.88) { overlap = n; break; }
      }
      merged[merged.length - 1] = dedupeParagraphs(prevParas.concat(nextParas.slice(overlap))).join('\n\n');
    }
    cleanOutput.value = merged.join('\n\n').trim();

    cleanOutput.hidden = false;
    rawOutput.hidden = true;
    $('showScannerClean')?.classList.add('primary');
    $('showScannerRaw')?.classList.remove('primary');

    if (status) {
      status.textContent = failures.length
        ? `อ่านสำเร็จ ${ordered.length - failures.length}/${ordered.length} ไฟล์ · มีไฟล์ผิดพลาด ${failures.length} ไฟล์`
        : `อ่านเสร็จแล้ว ${ordered.length} ไฟล์ · ทำความสะอาดและรวมข้อความซ้ำแล้ว`;
    }

    if (failures.length) {
      console.warn('[Novel Studio V48 OCR failures]', failures);
      toast('มีบางไฟล์อ่านไม่สำเร็จ ดูรายละเอียดใน Console');
    } else {
      toast('อ่านข้อความเสร็จแล้ว');
    }
  }

  function installPatch() {
    setVersionBadge();

    const input = $('scannerInput');
    if (input) {
      input.onchange = async event => {
        const files = [...(event.target.files || [])];
        try {
          if (files.length) await handleFiles(files);
        } finally {
          event.target.value = '';
        }
      };
    }

    const cleanButton = $('showScannerClean');
    if (cleanButton) {
      cleanButton.onclick = () => {
        const raw = $('scannerRawText')?.value || '';
        const clean = $('scannerText');
        if (clean && raw) clean.value = cleanOcrText(raw);
        if (clean) clean.hidden = false;
        if ($('scannerRawText')) $('scannerRawText').hidden = true;
        cleanButton.classList.add('primary');
        $('showScannerRaw')?.classList.remove('primary');
      };
    }

    const rawButton = $('showScannerRaw');
    if (rawButton) {
      rawButton.onclick = () => {
        if ($('scannerText')) $('scannerText').hidden = true;
        if ($('scannerRawText')) $('scannerRawText').hidden = false;
        rawButton.classList.add('primary');
        cleanButton?.classList.remove('primary');
      };
    }

    window.NovelStudioScannerV48 = {
      version: PATCH_VERSION,
      cleanOcrText,
      handleFiles
    };

    console.info('Novel Studio Scanner V48 installed');
  }

  if (document.readyState === 'complete') {
    window.setTimeout(installPatch, 0);
  } else {
    window.addEventListener('load', installPatch, { once: true });
  }
})();
