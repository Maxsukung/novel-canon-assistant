NOVEL STUDIO V46 — วิธีติดตั้ง

ไฟล์ในชุดนี้
1. scanner-v46.js   ตัวแก้ระบบ OCR/สแกนเอกสาร
2. sw.js            Service Worker เวอร์ชันใหม่
3. version.json     หมายเลขเวอร์ชัน
4. CHANGELOG-V46-TH.txt

วิธีติดตั้งใน GitHub
1. อัปโหลด scanner-v46.js, sw.js, version.json และ CHANGELOG-V46-TH.txt ทับ/เพิ่มในโฟลเดอร์หลัก
2. เปิด index.html แล้วเพิ่มบรรทัดนี้ "หลัง app.js" และก่อน </body>

   <script src="./scanner-v46.js?v=46"></script>

3. Commit การแก้ไข
4. เปิดแอป รอประมาณ 30 วินาที หรือปิดแล้วเปิดหนึ่งครั้ง
5. ส่วนหัวควรแสดง V46

สิ่งที่ V46 แก้
- ตัดวงจร recursive ที่ทำให้ Maximum call stack size exceeded
- OCR รูปภาพครั้งเดียวต่อไฟล์
- เก็บสระและวรรณยุกต์ไทยด้วย Unicode NFC
- ตัดเวลา แบตเตอรี่ URL ชื่อไฟล์ และข้อความจาก UI
- ไม่แทรกข้อความ error ลงในต้นฉบับ
- รวมย่อหน้าซ้ำแบบ exact และ near-duplicate
- รักษาภาษาอังกฤษที่เป็นคำ/ประโยคมีความหมาย
- PDF ที่มีข้อความจริงจะอ่านข้อความโดยตรงก่อนใช้ OCR

หมายเหตุ
app.js เดิมยังเป็น V45 แต่ scanner-v46.js จะเข้าควบคุมเฉพาะหน้าสแกนเอกสารหลัง app.js โหลดเสร็จ
