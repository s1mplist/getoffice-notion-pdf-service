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

async function downloadAndOptimizeImages(imageUrls: string[]): Promise<Map<string, string>> {
    const MAX_WIDTH = 900;
    const MAX_HEIGHT = 1400;
    const QUALITY = 70;

    const uniqueUrls = [...new Set(imageUrls)];
    console.log(`[Images] Processing ${uniqueUrls.length} unique images (${imageUrls.length - uniqueUrls.length} duplicates removed)`);

    const startTime = Date.now();
    const optimizedImages = new Map<string, string>();

    const BATCH_SIZE = 10;
    const batches: string[][] = [];

    for (let i = 0; i < uniqueUrls.length; i += BATCH_SIZE) {
        batches.push(uniqueUrls.slice(i, i + BATCH_SIZE));
    }

    let processedCount = 0;

    for (const batch of batches) {
        const promises = batch.map(async (url, batchIndex) => {
            const index = processedCount + batchIndex;
            try {
                const response = await fetch(url, {
                    signal: AbortSignal.timeout(10000),
                });

                if (!response.ok) {
                    console.warn(`[Image ${index + 1}] HTTP ${response.status}`);
                    return;
                }

                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const originalSize = buffer.length;

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

                const optimizedSize = optimized.length;
                const base64 = `data:image/jpeg;base64,${optimized.toString('base64')}`;
                const base64Size = base64.length;

                optimizedImages.set(url, base64);

                console.log(`[Image ${index + 1}] ✓ Original: ${(originalSize / 1024).toFixed(0)}KB → Optimized: ${(optimizedSize / 1024).toFixed(0)}KB → Base64: ${(base64Size / 1024).toFixed(0)}KB`);
            } catch (error) {
                console.error(`[Image ${index + 1}] ✗`, error instanceof Error ? error.message : 'Unknown error');
            }
        });

        await Promise.all(promises);
        processedCount += batch.length;
    }

    const duration = Date.now() - startTime;
    const totalBase64Size = Array.from(optimizedImages.values()).reduce((acc, v) => acc + v.length, 0);
    console.log(`[Images] ✓ ${optimizedImages.size}/${uniqueUrls.length} images in ${(duration / 1000).toFixed(2)}s`);
    console.log(`[Images] Total base64 size: ${(totalBase64Size / 1024 / 1024).toFixed(2)}MB`);

    return optimizedImages;
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

        console.log(`[PDF] Loading page...`);

        await page.goto(url, {
            waitUntil: ["load", "domcontentloaded"],
            timeout: 60000,
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
        await new Promise((resolve) => setTimeout(resolve, 500));

        console.log(`[PDF] Waiting for images...`);

        await page.evaluate(async () => {
            const images = Array.from(document.querySelectorAll('img')) as HTMLImageElement[];

            await Promise.all(
                images.map((img) => {
                    if (img.complete && img.naturalHeight !== 0) {
                        return Promise.resolve();
                    }

                    return new Promise<void>((resolve) => {
                        const timeout = setTimeout(resolve, 8000);

                        img.addEventListener('load', () => {
                            clearTimeout(timeout);
                            resolve();
                        }, { once: true });

                        img.addEventListener('error', () => {
                            clearTimeout(timeout);
                            resolve();
                        }, { once: true });
                    });
                })
            );
        });

        console.log(`[PDF] Extracting image URLs...`);

        const imageUrls = await page.evaluate(() => {
            const images = Array.from(document.querySelectorAll('img')) as HTMLImageElement[];

            return images
                .map(img => img.src)
                .filter(src =>
                    src &&
                    src.startsWith('http') &&
                    !src.includes('data:image')
                    // Removido filtro de twemoji e emoji
                );
        });

        console.log(`[PDF] Found ${imageUrls.length} images to optimize`);

        let optimizedImages = new Map<string, string>();
        if (imageUrls.length > 0) {
            optimizedImages = await downloadAndOptimizeImages(imageUrls);
        }

        if (optimizedImages.size > 0) {
            console.log(`[PDF] Injecting ${optimizedImages.size} optimized images...`);

            const imageMapArray = Array.from(optimizedImages.entries());

            const replacementResult = await page.evaluate((imageArray: [string, string][]) => {
                const images = Array.from(document.querySelectorAll('img')) as HTMLImageElement[]; // Removido :not(.emoji)
                let replacedCount = 0;
                let notFoundCount = 0;

                images.forEach(img => {
                    const imgUrlBase = img.src.split('?')[0];

                    // Procurar match exato primeiro
                    let optimizedSrc = imageArray.find(([url]) => url === img.src)?.[1];

                    // Se não encontrar, tentar match sem query params
                    if (!optimizedSrc) {
                        optimizedSrc = imageArray.find(([url]) => url.split('?')[0] === imgUrlBase)?.[1];
                    }

                    if (optimizedSrc) {
                        const oldSrc = img.src.substring(0, 80);
                        img.src = optimizedSrc;
                        replacedCount++;
                        console.log(`✓ Replaced [${replacedCount}]: ${oldSrc}...`);
                    } else {
                        notFoundCount++;
                        console.warn(`✗ Not found [${notFoundCount}]: ${img.src.substring(0, 80)}...`);
                    }
                });

                return { replacedCount, notFoundCount, totalImages: images.length };
            }, imageMapArray);

            console.log(`[PDF] Replacement result:`, replacementResult);
            console.log(`[PDF] Waiting for base64 images to render...`);
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }

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