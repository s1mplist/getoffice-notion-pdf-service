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

    // Remover duplicatas
    const uniqueUrls = [...new Set(imageUrls)];
    console.log(`[Images] Processing ${uniqueUrls.length} unique images (${imageUrls.length - uniqueUrls.length} duplicates removed)`);
    
    const startTime = Date.now();
    const optimizedImages = new Map<string, string>();

    // Aumentar batch size para 10 (mais paralelismo)
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
                // Reduzir timeout de 20s para 10s
                const response = await fetch(url, {
                    signal: AbortSignal.timeout(10000),
                });

                if (!response.ok) {
                    console.warn(`[Image ${index + 1}] HTTP ${response.status}`);
                    return;
                }

                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                // Otimização mais agressiva
                const optimized = await sharp(buffer)
                    .rotate()
                    .resize(MAX_WIDTH, MAX_HEIGHT, {
                        fit: 'inside',
                        withoutEnlargement: true,
                    })
                    .jpeg({ 
                        quality: QUALITY, 
                        mozjpeg: true,
                        progressive: true // Reduz tamanho
                    })
                    .toBuffer();

                const base64 = `data:image/jpeg;base64,${optimized.toString('base64')}`;
                optimizedImages.set(url, base64);

                console.log(`[Image ${index + 1}] ✓ ${(buffer.length / 1024).toFixed(0)}KB → ${(optimized.length / 1024).toFixed(0)}KB`);
            } catch (error) {
                console.error(`[Image ${index + 1}] ✗`, error instanceof Error ? error.message : 'Unknown error');
            }
        });

        await Promise.all(promises);
        processedCount += batch.length;
    }

    const duration = Date.now() - startTime;
    console.log(`[Images] ✓ ${optimizedImages.size}/${uniqueUrls.length} images in ${(duration / 1000).toFixed(2)}s`);

    return optimizedImages;
}

export const makePDFFromDomain = async (url: string): Promise<Buffer> => {
    let browser;
    try {
        console.log(`[PDF] Starting: ${url}`);
        const startTime = Date.now();
        
        browser = await getBrowser();
        const page = await browser.newPage();

        page.setDefaultTimeout(90000);
        page.setDefaultNavigationTimeout(90000);

        await page.setViewport({ width: 1080, height: 1024 });

        console.log(`[PDF] Loading...`);
        
        await page.goto(url, {
            waitUntil: ["load", "domcontentloaded"],
            timeout: 60000, // Reduzido de 90s
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
            
            // Desabilitar IntersectionObserver
            if (window.IntersectionObserver) {
                window.IntersectionObserver = class MockIntersectionObserver {
                    constructor() {}
                    observe() {}
                    unobserve() {}
                    disconnect() {}
                } as any;
            }
        });

        // Reduzido de 2s para 500ms
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
                        // Reduzido de 15s para 8s
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

        console.log(`[PDF] Extracting URLs...`);

        const imageUrls = await page.evaluate(() => {
            const images = Array.from(document.querySelectorAll('img')) as HTMLImageElement[];
            
            return images
                .map(img => img.src)
                .filter(src => 
                    src && 
                    src.startsWith('http') && 
                    !src.includes('data:image') &&
                    !src.includes('twemoji') &&
                    !src.includes('emoji')
                );
        });

        console.log(`[PDF] Found ${imageUrls.length} images`);

        if (imageUrls.length > 0) {
            const optimizedImages = await downloadAndOptimizeImages(imageUrls);

            console.log(`[PDF] Injecting ${optimizedImages.size} images...`);

            await page.evaluate((imageMap: Record<string, string>) => {
                const images = Array.from(document.querySelectorAll('img:not(.emoji)')) as HTMLImageElement[];
                
                images.forEach(img => {
                    const optimizedSrc = imageMap[img.src];
                    if (optimizedSrc) {
                        img.src = optimizedSrc;
                    }
                });
            }, Object.fromEntries(optimizedImages));
        }

        // Reduzido de 2s para 500ms
        await new Promise((resolve) => setTimeout(resolve, 500));

        console.log(`[PDF] Generating PDF...`);

        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
            preferCSSPageSize: true,
            displayHeaderFooter: false,
            scale: 1.0,
            timeout: 90000,
            omitBackground: false,
        });

        await browser.close();
        
        const duration = Date.now() - startTime;
        console.log(`[PDF] ✓ Generated in ${(duration / 1000).toFixed(2)}s`);
        
        return Buffer.from(pdf);
    } catch (error) {
        if (browser) {
            await browser.close();
        }
        console.error("PDF generation error:", error);
        throw error;
    }
};