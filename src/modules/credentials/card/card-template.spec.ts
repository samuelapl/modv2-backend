import { loadCardAssets } from './card-assets';
import { renderBack, renderCard, renderFront } from './card-template';
import { sampleCardData } from './card.fixture';

describe('card template', () => {
  const assets = loadCardAssets();

  it('front: restriction strip, bilingual header, holder + licence data', async () => {
    const html = renderFront(await sampleCardData(), assets);
    expect(html).toContain('FOR OFFICIAL MILITARY USE ONLY');
    expect(html).toContain('ለወታደራዊ ሥራ ብቻ የሚውል');
    expect(html).toContain('የኢፌዴሪ መከላከያ ሚኒስቴር');
    expect(html).toContain('MOD-DEMO-006'); // military service ID under the photo
    expect(html).toContain('ሙሉ ስም'); // full-name label
    expect(html).toContain('Kidist Mengistu Zewdie');
    expect(html).not.toContain('Sgt.'); // rank is not printed
    expect(html).toContain('ክድስት መንግስቱ ዘውዴ');
    // Ethiopian dates: normal digits + Amharic month + ዓ.ም; Gregorian as dd/mm/yyyy
    expect(html).toContain('14 መስከረም 1992 ዓ.ም');
    expect(html).toContain('25/09/1999 እ.ኤ.አ');
    expect(html).toContain('O+');
    expect(html).toContain('MED-CORPS — Military Health &amp; Ambulance Directorate');
    expect(html).toContain('MOD-AUTH-2026-0006');
    expect(html).toContain('CAT-HV');
    expect(html).toContain('9 ጥቅምት 2019 ዓ.ም');
    expect(html).toContain('9 ጥቅምት 2022 ዓ.ም');
    expect(html).toContain('19/10/2029 እ.ኤ.አ');
  });

  it('front labels are Amharic only (no English labels, no E.C./G.C. suffixes)', async () => {
    const html = renderFront(await sampleCardData(), assets);
    for (const label of ['የትውልድ ቀን', 'የደም ዓይነት', 'መምሪያ', 'የፈቃድ ቁጥር', 'የተፈቀደ ምድብ', 'የተሰጠበት ቀን', 'የሚያበቃበት ቀን']) {
      expect(html).toContain(label);
    }
    // every label is Amharic (values such as the directorate name may still be Latin)
    const labels = [...html.matchAll(/<div class="lbl">([^<]*)</g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThanOrEqual(8);
    for (const text of labels) expect(text).not.toMatch(/[A-Za-z]/);
    expect(html).not.toMatch(/E\.C\.|G\.C\./);
  });

  it('back: QR, serial, category legend, issuing authority, return instructions', async () => {
    const html = renderBack(await sampleCardData(), assets);
    expect(html).toContain('data:image/png;base64'); // QR image
    expect(html).toContain('SN-MOD-2026-279BF8');
    expect(html).toContain('CAT-HV</b> — Heavy Vehicle');
    expect(html).toContain('MoND Transport &amp; Logistics Main Department');
    expect(html).toContain('If found, return');
  });

  it('is static: no controls, scripts, countdown, print stamp or clerk name', async () => {
    const html = renderCard(await sampleCardData(), assets);
    expect(html).not.toMatch(/<button|<script|<input/i);
    expect(html).not.toMatch(/Copy QR|Expires in|Printed|Limit reached|Issued by/i);
  });

  it('sets the CR80 page size and embeds the Ethiopic font', async () => {
    const html = renderCard(await sampleCardData(), assets);
    expect(html).toContain('size: 85.6mm 53.98mm');
    expect(html).toContain("font-family: 'Noto Sans Ethiopic'");
    expect(html).toContain('data:font/ttf;base64');
  });

  it('escapes holder-supplied text', async () => {
    const html = renderFront(
      await sampleCardData({ nameEn: '<img src=x onerror=alert(1)>' }),
      assets,
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
