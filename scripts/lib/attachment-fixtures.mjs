import { readFile } from "node:fs/promises";

export const fixturePng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV2sAAAAASUVORK5CYII=", "base64");

function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (~crc) >>> 0;
}

// Stored ZIP entries keep the office fixtures inspectable without a package
// manager, system office installation or a network dependency.
function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const filename = Buffer.from(name), bytes = Buffer.from(text), crc = crc32(bytes);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, bytes);
    const index = Buffer.alloc(46); index.writeUInt32LE(0x02014b50); index.writeUInt16LE(20, 4); index.writeUInt16LE(20, 6); index.writeUInt32LE(crc, 16); index.writeUInt32LE(bytes.length, 20); index.writeUInt32LE(bytes.length, 24); index.writeUInt16LE(filename.length, 28); index.writeUInt32LE(offset, 42);
    central.push(index, filename); offset += header.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function pdf() {
  const text = "BT /F1 18 Tf 40 100 Td (SQUAD_PDF_42) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 150] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${text.length} >>\nstream\n${text}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let body = "%PDF-1.4\n", offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const start = Buffer.byteLength(body);
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(body);
}

export async function attachmentFixtures() {
  const docx = zip({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>SQUAD_DOCX_42</w:t></w:r></w:p></w:body></w:document>',
  });
  const xlsx = zip({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Test" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>SQUAD_XLSX_42</t></is></c><c r="B1"><v>42</v></c></row></sheetData></worksheet>',
  });
  return [
    { name: "screenshot.png", mime: "image/png", bytes: fixturePng },
    { name: "portrait.jpeg", mime: "image/jpeg", bytes: await readFile(new URL("../../public/avatars/backend-engineer.jpg", import.meta.url)) },
    { name: "diagram.svg", mime: "image/svg+xml", bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="red"/></svg>') },
    { name: "spec.pdf", mime: "application/pdf", bytes: pdf() },
    { name: "word.doc", mime: "application/msword", bytes: Buffer.from('{\\rtf1\\ansi SQUAD_DOC_42}') },
    { name: "word.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: docx },
    { name: "ledger.xls", mime: "application/vnd.ms-excel", bytes: Buffer.from('<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Test"><Table><Row><Cell><Data ss:Type="String">SQUAD_XLS_42</Data></Cell></Row></Table></Worksheet></Workbook>') },
    { name: "ledger.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: xlsx },
    // Opaque font bytes test preservation, not font parsing or rendering.
    { name: "Typeface.ttf", mime: "font/ttf", bytes: Buffer.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) },
    { name: "table.csv", mime: "text/csv", bytes: Buffer.from("label,value\nSQUAD_CSV_42,42\n") },
  ];
}
