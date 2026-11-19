import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { Browser } from 'puppeteer';

const RENDER_TIMEOUT_MS = 15_000;

/**
 * The only place that touches Chromium: HTML in, PDF bytes out.
 * One shared browser (started on first use), one short-lived page per render.
 * Swapping to Gotenberg later means replacing only `render()`.
 */
@Injectable()
export class CardPdfService implements OnModuleDestroy {
  private readonly logger = new Logger(CardPdfService.name);
  private browser: Promise<Browser> | null = null;

  private getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = puppeteer
        .launch({
          // chrome-headless-shell: the build meant for server-side PDF/screenshots
          // (the full Chrome "new headless" mode hangs on page.pdf() on some hosts).
          headless: 'shell',
          // Inside a container Chromium needs this; keep it off on dev machines.
          args:
            process.env.PUPPETEER_NO_SANDBOX === 'true'
              ? ['--no-sandbox', '--disable-setuid-sandbox']
              : [],
        })
        .then((browser) => {
          browser.on('disconnected', () => {
            this.browser = null;
          });
          return browser;
        })
        .catch((err) => {
          this.browser = null;
          throw err;
        });
    }
    return this.browser;
  }

  /** Renders the two-page CR80 document (85.6 mm x 53.98 mm). */
  async render(html: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      page.setDefaultTimeout(RENDER_TIMEOUT_MS);
      // The card is self-contained (data: URIs only): refuse anything else.
      await page.setRequestInterception(true);
      page.on('request', (req) =>
        req.url().startsWith('data:') || req.url() === 'about:blank'
          ? void req.continue()
          : void req.abort(),
      );
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const pdf = await page.pdf({
        width: '85.6mm',
        height: '53.98mm',
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async onModuleDestroy() {
    if (!this.browser) return;
    try {
      await (await this.browser).close();
    } catch (err) {
      this.logger.warn(`Chromium did not close cleanly: ${(err as Error).message}`);
    }
  }
}
