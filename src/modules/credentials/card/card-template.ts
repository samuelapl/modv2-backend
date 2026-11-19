import type { CardData } from './card-data.builder';
import type { CardAssets } from './card-assets';

/**
 * Printable CR80 card (85.6 mm × 53.98 mm), front + back, as one HTML document.
 * Pure string templates: no database, no Nest, no scripts. Static on purpose —
 * no buttons, countdowns, live status, print timestamps or clerk names.
 * To preview a card, save the output as .html and open it in a browser.
 */

const RESTRICTION_EN = 'FOR OFFICIAL MILITARY USE ONLY';
const RESTRICTION_AM = 'ለወታደራዊ ሥራ ብቻ የሚውል';

const esc = (v: string): string =>
  v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const STYLES = (a: CardAssets): string => `
@font-face { font-family: 'Noto Sans Ethiopic'; font-weight: 400;
  src: url(data:font/ttf;base64,${a.fontRegularB64}) format('truetype'); }
@font-face { font-family: 'Noto Sans Ethiopic'; font-weight: 700;
  src: url(data:font/ttf;base64,${a.fontBoldB64}) format('truetype'); }

@page { size: 85.6mm 53.98mm; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 85.6mm; background: #fff; }
body {
  font-family: 'Noto Sans Ethiopic', Arial, 'Liberation Sans', 'DejaVu Sans', sans-serif;
  color: #1c2208; -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
:root { --olive: #34401a; --gold: #c9a227; --cream: #fbf8ee; --red: #9b1c1c; --muted: #5b6240; }

.page { position: relative; width: 85.6mm; height: 53.98mm; overflow: hidden; background: var(--cream); }
.page + .page { break-before: page; }

/* ---------- shared ---------- */
.header { display: flex; align-items: center; gap: 1.6mm; height: 9.4mm; padding: 0.8mm 2.6mm;
  background: var(--olive); color: #fff; border-bottom: 0.5mm solid var(--gold); }
.header .logo { width: 7.8mm; height: 7.8mm; flex: none; border-radius: 50%; background: #fff;
  object-fit: cover; object-position: center; }
.header .titles { flex: 1; line-height: 1.2; }
.header .am { font-size: 6.4pt; font-weight: 700; }
.header .en { font-size: 4.8pt; letter-spacing: 0.15mm; }
.header .kind { text-align: right; line-height: 1.2; }
.header .kind .am { font-size: 5pt; font-weight: 700; color: var(--gold); }
.header .kind .en { font-size: 4.4pt; }
.strip { height: 3.5mm; display: flex; align-items: center; justify-content: center; gap: 1.6mm;
  background: var(--red); color: #fff; font-size: 4.6pt; font-weight: 700; letter-spacing: 0.2mm; }

.lbl { font-size: 4.3pt; font-weight: 700; color: var(--muted); line-height: 1.2; }
.val { font-size: 5.8pt; font-weight: 700; line-height: 1.25; }
.val small { display: block; font-size: 4.7pt; font-weight: 400; }

/* ---------- front ---------- */
.body { display: flex; gap: 2.6mm; padding: 2mm 2.6mm 0; }
.photo { width: 18.5mm; flex: none; text-align: center; }
.photo .frame { width: 18.5mm; height: 24.6mm; border: 0.3mm solid var(--olive); background: #e6e2d0; overflow: hidden; }
.photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.photo .sid { margin-top: 1mm; font-size: 5.6pt; font-weight: 700; letter-spacing: 0.1mm; }
.info { flex: 1; min-width: 0; }
.name-am { font-size: 8pt; font-weight: 700; line-height: 1.2; }
.name-en { font-size: 5.8pt; font-weight: 700; line-height: 1.2; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.9mm 2mm; margin-top: 1.4mm; }
.span2 { grid-column: 1 / -1; }
.blood { font-size: 8pt; font-weight: 700; color: var(--red); line-height: 1; }
.cat { display: inline-block; margin-right: 0.8mm; padding: 0 1mm; border-radius: 0.6mm;
  background: var(--olive); color: #fff; font-size: 5pt; font-weight: 700; }

/* ---------- back ---------- */
.back-header { height: 6.6mm; padding: 0.6mm 2.6mm; }
.back-header .logo { width: 5.4mm; height: 5.4mm; }
.back-body { display: flex; gap: 2.6mm; padding: 2mm 2.6mm 0; height: 33.5mm; }
.qr { width: 25mm; flex: none; text-align: center; }
.qr .box { width: 25mm; height: 25mm; padding: 1mm; background: #fff; border: 0.3mm solid #000; }
.qr img { width: 100%; height: 100%; display: block; image-rendering: pixelated; }
.qr .cap { margin-top: 0.8mm; font-size: 4pt; font-weight: 700; }
.right { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1mm; }
.serial { font-family: 'Courier New', monospace; font-size: 6.2pt; font-weight: 700; letter-spacing: 0.1mm; }
.legend { font-size: 4.4pt; line-height: 1.3; }
.legend b { color: var(--olive); }
.sign { margin-top: auto; display: flex; align-items: flex-end; gap: 2mm; }
.sign svg { flex: none; }
.sign .line { flex: 1; border-top: 0.2mm solid #000; padding-top: 0.5mm; }
.foot { position: absolute; left: 0; right: 0; bottom: 0; height: 8.6mm; padding: 1mm 2.6mm;
  background: var(--olive); color: #fff; font-size: 4.2pt; line-height: 1.3; border-top: 0.5mm solid var(--gold); }
.foot .am { color: var(--gold); }
`;

function header(a: CardAssets, small: boolean): string {
  return `
  <div class="header${small ? ' back-header' : ''}">
    <img class="logo" src="${a.logoDataUri}" alt="" />
    <div class="titles">
      <div class="am">የኢፌዴሪ መከላከያ ሚኒስቴር</div>
      <div class="en">Ministry of National Defence</div>
    </div>
    <div class="kind">
      <div class="am">የወታደራዊ መንጃ ፈቃድ</div>
      <div class="en">Military Driving Permit</div>
    </div>
  </div>`;
}

const SILHOUETTE = `<svg viewBox="0 0 40 52" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
  <rect width="40" height="52" fill="#e6e2d0"/>
  <circle cx="20" cy="19" r="8" fill="#a9a58f"/>
  <path d="M4 52c0-12 7-19 16-19s16 7 16 19z" fill="#a9a58f"/></svg>`;

export function renderFront(d: CardData, a: CardAssets): string {
  const photo = d.photoDataUri
    ? `<img src="${d.photoDataUri}" alt="" />`
    : SILHOUETTE;
  const cats = d.categories
    .map((c) => `<span class="cat">${esc(c.code)}</span>`)
    .join('');

  return `
<section class="page front">
  ${header(a, false)}
  <div class="strip"><span>${RESTRICTION_EN}</span><span>·</span><span>${RESTRICTION_AM}</span></div>
  <div class="body">
    <div class="photo">
      <div class="frame">${photo}</div>
      <div class="sid">${esc(d.serviceId)}</div>
      <div class="lbl">የአገልግሎት መታወቂያ ቁጥር</div>
    </div>
    <div class="info">
      <div class="lbl">ሙሉ ስም</div>
      <div class="name-am">${esc(d.nameAm)}</div>
      <div class="name-en">${esc(d.nameEn)}</div>
      <div class="grid">
        <div>
          <div class="lbl">የትውልድ ቀን</div>
          <div class="val">${esc(d.dateOfBirth.ec)}<small>${esc(d.dateOfBirth.gc)}</small></div>
        </div>
        <div>
          <div class="lbl">የደም ዓይነት</div>
          <div class="blood">${esc(d.bloodGroup)}</div>
        </div>
        <div class="span2">
          <div class="lbl">መምሪያ</div>
          <div class="val">${esc(d.directorate)}</div>
        </div>
        <div>
          <div class="lbl">የፈቃድ ቁጥር</div>
          <div class="val">${esc(d.permitNumber)}</div>
        </div>
        <div>
          <div class="lbl">የተፈቀደ ምድብ</div>
          <div class="val">${cats}</div>
        </div>
        <div>
          <div class="lbl">የተሰጠበት ቀን</div>
          <div class="val">${esc(d.issueDate.ec)}<small>${esc(d.issueDate.gc)}</small></div>
        </div>
        <div>
          <div class="lbl">የሚያበቃበት ቀን</div>
          <div class="val">${esc(d.expiryDate.ec)}<small>${esc(d.expiryDate.gc)}</small></div>
        </div>
      </div>
    </div>
  </div>
</section>`;
}

const STAMP = `<svg width="13mm" height="13mm" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
  <circle cx="30" cy="30" r="27" fill="none" stroke="#34401a" stroke-width="2"/>
  <circle cx="30" cy="30" r="21" fill="none" stroke="#34401a" stroke-width="0.8"/>
  <polygon transform="translate(0,-3)" points="30,17 33,26 42,26 35,32 38,41 30,35.5 22,41 25,32 18,26 27,26" fill="#34401a"/>
  <text x="30" y="44.5" font-size="4.6" text-anchor="middle" fill="#34401a" font-family="Arial" font-weight="700">MoND</text>
</svg>`;

const SIGNATURE = `<svg width="16mm" height="7mm" viewBox="0 0 80 35" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 26c8-20 14-22 12-8-2 12 6 6 12-4s8-8 6 2 6 6 12-2 8-6 6 2 10-4 14-8"
        fill="none" stroke="#1a2a6a" stroke-width="1.6" stroke-linecap="round"/></svg>`;

export function renderBack(d: CardData, a: CardAssets): string {
  const legend = d.categories
    .map((c) => `<div><b>${esc(c.code)}</b> — ${esc(c.name)}</div>`)
    .join('');

  return `
<section class="page back">
  ${header(a, true)}
  <div class="back-body">
    <div class="qr">
      <div class="box"><img src="${d.qrDataUrl}" alt="" /></div>
      <div class="cap">SCAN TO VERIFY · ለማረጋገጥ ይቃኙ</div>
    </div>
    <div class="right">
      <div>
        <div class="lbl">የካርድ ተከታታይ ቁጥር</div>
        <div class="serial">${esc(d.serial)}</div>
      </div>
      <div>
        <div class="lbl">የተፈቀዱ ምድቦች</div>
        <div class="legend">${legend}</div>
      </div>
      <div>
        <div class="lbl">ሰጪ አካል</div>
        <div class="val">${esc(d.issuingAuthority.en)}<small>${esc(d.issuingAuthority.am)}</small></div>
      </div>
      <div class="sign">
        ${STAMP}
        <div class="line">${SIGNATURE}<div class="lbl">የተፈቀደለት ፊርማ</div></div>
      </div>
    </div>
  </div>
  <div class="foot">
    If found, return to the nearest Ministry of National Defence or Military Police office.
    This card is government property; valid only with a verified QR code.
    <div class="am">ከተገኘ ለቅርብ የመከላከያ ሚኒስቴር ወይም ወታደራዊ ፖሊስ ቢሮ ያስረክቡ። ይህ ካርድ የመንግሥት ንብረት ነው።</div>
  </div>
</section>`;
}

/** Full two-page document: page 1 = front, page 2 = back. */
export function renderCard(d: CardData, a: CardAssets): string {
  return `<!doctype html>
<html lang="am"><head><meta charset="utf-8" />
<title>${esc(d.permitNumber)}</title>
<style>${STYLES(a)}</style></head>
<body>${renderFront(d, a)}${renderBack(d, a)}</body></html>`;
}
