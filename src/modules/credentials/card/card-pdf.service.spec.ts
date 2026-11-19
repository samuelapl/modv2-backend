import { CardPdfService } from './card-pdf.service';
import { loadCardAssets } from './card-assets';
import { renderCard } from './card-template';
import { sampleCardData } from './card.fixture';

/** Real Chromium: proves the PDF is exactly two CR80 pages with the embedded font. */
describe('CardPdfService (real Chromium)', () => {
  const service = new CardPdfService();
  afterAll(() => service.onModuleDestroy());

  it('renders a 2-page 85.6 x 53.98 mm PDF', async () => {
    const pdf = await service.render(renderCard(await sampleCardData(), loadCardAssets()));
    const text = pdf.toString('latin1');

    expect(text.startsWith('%PDF')).toBe(true);
    // Page objects only (not the /Pages tree node).
    expect(text.match(/\/Type\s*\/Page(?!s)/g)).toHaveLength(2);

    // MediaBox is in points: 85.6 mm = 242.6 pt, 53.98 mm = 153.0 pt.
    const box = text.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
    expect(box).not.toBeNull();
    expect(Number(box![1])).toBeCloseTo(242.65, 0);
    expect(Number(box![2])).toBeCloseTo(153.02, 0);

    // The Amharic font is embedded, not referenced from the OS.
    expect(text).toMatch(/NotoSansEthiopic/);
  }, 60_000);
});
