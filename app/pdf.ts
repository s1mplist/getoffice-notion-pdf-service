// @/lib/pdf.ts
import chromium from "@sparticuz/chromium";
import puppeteerCore from "puppeteer-core";
import sharp from "sharp";

async function getBrowser() {
    const REMOTE_PATH = process.env.CHROMIUM_REMOTE_EXEC_PATH;
    const LOCAL_PATH = process.env.CHROMIUM_LOCAL_EXEC_PATH;

    console.log('[Browser] REMOTE_PATH:', REMOTE_PATH ? '✓ Set' : '✗ Not set');
    console.log('[Browser] LOCAL_PATH:', LOCAL_PATH ? '✓ Set' : '✗ Not set');

    if (!REMOTE_PATH && !LOCAL_PATH) {
        throw new Error("Missing a path for chromium executable");
    }

    if (!!REMOTE_PATH) {
        console.log('[Browser] Using REMOTE Chromium from blob storage');
        return await puppeteerCore.launch({
            args: [
                ...chromium.args,
                '--font-render-hinting=none',
            ],
            executablePath: await chromium.executablePath(REMOTE_PATH),
            defaultViewport: null,
            headless: true,
        });
    }

    return await puppeteerCore.launch({
        executablePath: LOCAL_PATH,
        defaultViewport: null,
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--font-render-hinting=none',
        ],
    });
}

async function downloadAndOptimizeImage(url: string): Promise<Buffer | null> {
    const MAX_WIDTH = 900;
    const MAX_HEIGHT = 1400;
    const QUALITY = 70;

    try {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
            return null;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const optimized = await sharp(buffer)
            .rotate()
            .resize(MAX_WIDTH, MAX_HEIGHT, {
                fit: 'inside',
                withoutEnlargement: true,
            })
            .jpeg({
                quality: QUALITY,
                mozjpeg: true,
                progressive: true
            })
            .toBuffer();

        return optimized;
    } catch (error) {
        console.error(`[Image Optimization] Error for ${url.substring(0, 50)}:`, error instanceof Error ? error.message : 'Unknown');
        return null;
    }
}

export const makePDFFromDomain = async (url: string): Promise<Buffer> => {
    let browser;
    try {
        console.log(`[PDF] Starting: ${url}`);
        const startTime = Date.now();

        browser = await getBrowser();
        const page = await browser.newPage();

        page.setDefaultTimeout(60000);
        page.setDefaultNavigationTimeout(60000);

        await page.setViewport({ width: 1080, height: 1024 });

        // Cache para imagens otimizadas
        const imageCache = new Map<string, Buffer>();
        let optimizedCount = 0;
        let skippedCount = 0;

        // Habilitar request interception
        await page.setRequestInterception(true);

        page.on('request', async (request) => {
            const resourceType = request.resourceType();
            const requestUrl = request.url();

            // Interceptar apenas imagens (não emoji/twemoji)
            if (resourceType === 'image' &&
                requestUrl.startsWith('http') &&
                !requestUrl.includes('twemoji') &&
                !requestUrl.includes('emoji') &&
                !requestUrl.includes('data:image')) {

                // Verificar se já está no cache
                if (imageCache.has(requestUrl)) {
                    const optimizedBuffer = imageCache.get(requestUrl)!;
                    request.respond({
                        status: 200,
                        contentType: 'image/jpeg',
                        body: optimizedBuffer
                    });
                    return;
                }

                // Otimizar em tempo real
                const optimizedBuffer = await downloadAndOptimizeImage(requestUrl);

                if (optimizedBuffer) {
                    imageCache.set(requestUrl, optimizedBuffer);
                    optimizedCount++;
                    console.log(`[Image ${optimizedCount}] ✓ Optimized on-the-fly: ${requestUrl.substring(0, 60)}...`);

                    request.respond({
                        status: 200,
                        contentType: 'image/jpeg',
                        body: optimizedBuffer
                    });
                } else {
                    // Se falhar, deixar carregar normalmente
                    request.continue();
                }
            } else {
                // Outros recursos (CSS, JS, fonts, emojis) - continuar normalmente
                request.continue();
            }
        });

        console.log(`[PDF] Loading page with on-the-fly image optimization...`);

        await page.goto(url, {
            waitUntil: ["load", "domcontentloaded"],
            timeout: 180000,
        });

        console.log(`[PDF] Applying styles...`);

        await page.evaluate(() => {
            const style = document.createElement('style');
            style.textContent = `
                @page {
                    size: A4;
                    margin: 15mm;
                }
                
                * {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', sans-serif !important;
                }
                
                html, body {
                    margin: 0 !important;
                    padding: 0 !important;
                    width: 100% !important;
                }
                
                body, p, span, div, h1, h2, h3, h4, h5, h6, li, td, th {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', sans-serif !important;
                    text-rendering: optimizeLegibility;
                    -webkit-font-smoothing: antialiased;
                    -moz-osx-font-smoothing: grayscale;
                }
                
                .talhao {
                    page-break-inside: avoid !important;
                    break-inside: avoid !important;
                    margin-bottom: 20px !important;
                }
                
                .gallery-image-wrapper, .image-wrapper {
                    page-break-inside: avoid !important;
                    break-inside: avoid !important;
                }
                
                .talhao-header, .talhao h2, .talhao h3 {
                    page-break-after: avoid !important;
                    break-after: avoid !important;
                }
                
                p, li {
                    orphans: 3;
                    widows: 3;
                }
                
                @media print {
                    * {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', sans-serif !important;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    
                    .talhao {
                        page-break-inside: avoid !important;
                        break-inside: avoid !important;
                    }
                    
                    .gallery-image-wrapper, .image-wrapper {
                        page-break-inside: avoid !important;
                        break-inside: avoid !important;
                    }
                    
                    .talhao-header, .talhao h2, .talhao h3 {
                        page-break-after: avoid !important;
                        break-after: avoid !important;
                    }
                }
            `;
            document.head.insertBefore(style, document.head.firstChild);

            // Remover lazy loading
            const allImages = document.querySelectorAll('img');
            allImages.forEach(img => {
                img.removeAttribute('loading');

                const dataSrc = img.getAttribute('data-src');
                if (dataSrc) {
                    img.src = dataSrc;
                    img.removeAttribute('data-src');
                }

                const dataSrcset = img.getAttribute('data-srcset');
                if (dataSrcset) {
                    img.srcset = dataSrcset;
                    img.removeAttribute('data-srcset');
                }
            });

            if (window.IntersectionObserver) {
                window.IntersectionObserver = class MockIntersectionObserver {
                    constructor() { }
                    observe() { }
                    unobserve() { }
                    disconnect() { }
                } as any;
            }
        });

        await page.evaluateHandle('document.fonts.ready');
        await new Promise((resolve) => setTimeout(resolve, 1000));

        console.log(`[PDF] Optimized ${optimizedCount} images on-the-fly`);
        console.log(`[PDF] Generating PDF...`);

        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
            preferCSSPageSize: true,
            displayHeaderFooter: false,
            scale: 1.0,
            timeout: 60000,
            omitBackground: false,
        });

        await browser.close();

        const duration = Date.now() - startTime;
        const pdfSize = pdf.length;
        console.log(`[PDF] ✓ Generated in ${(duration / 1000).toFixed(2)}s - Size: ${(pdfSize / 1024 / 1024).toFixed(2)}MB`);

        return Buffer.from(pdf);
    } catch (error) {
        if (browser) {
            await browser.close();
        }
        console.error("PDF generation error:", error);
        throw error;
    }
};