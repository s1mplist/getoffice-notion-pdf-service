// @/lib/pdf.ts
import chromium from "@sparticuz/chromium-min";
import puppeteerCore from "puppeteer-core";
import sharp from "sharp";

async function getBrowser() {
    const REMOTE_PATH = process.env.CHROMIUM_REMOTE_EXEC_PATH;
    const LOCAL_PATH = process.env.CHROMIUM_LOCAL_EXEC_PATH;
    if (!REMOTE_PATH && !LOCAL_PATH) {
        throw new Error("Missing a path for chromium executable");
    }

    if (!!REMOTE_PATH) {
        return await puppeteerCore.launch({
            args: [
                ...chromium.args,
                '--font-render-hinting=none', // Melhor renderização de fontes
            ],
            executablePath: await chromium.executablePath(REMOTE_PATH,
            ),
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

    console.log(`[Images] Downloading and optimizing ${imageUrls.length} images in parallel...`);
    const startTime = Date.now();

    const optimizedImages = new Map<string, string>();

    const BATCH_SIZE = 5;
    const batches: string[][] = [];

    for (let i = 0; i < imageUrls.length; i += BATCH_SIZE) {
        batches.push(imageUrls.slice(i, i + BATCH_SIZE));
    }

    let processedCount = 0;

    for (const batch of batches) {
        const promises = batch.map(async (url, batchIndex) => {
            const index = processedCount + batchIndex;
            try {
                console.log(`[Image ${index + 1}/${imageUrls.length}] Downloading: ${url.substring(0, 80)}...`);

                let response;
                let retries = 3;

                while (retries > 0) {
                    try {
                        response = await fetch(url, {
                            signal: AbortSignal.timeout(20000),
                        });

                        if (response.ok) break;

                        console.warn(`[Image ${index + 1}] Status ${response.status}, retrying...`);
                        retries--;
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    } catch (err) {
                        retries--;
                        if (retries === 0) throw err;
                        console.warn(`[Image ${index + 1}] Fetch error, retrying...`);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }

                if (!response || !response.ok) {
                    console.error(`[Image ${index + 1}] Failed to download after retries`);
                    return;
                }

                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                console.log(`[Image ${index + 1}] Downloaded ${(buffer.length / 1024).toFixed(2)}KB, optimizing...`);

                const optimized = await sharp(buffer)
                    .rotate()
                    .resize(MAX_WIDTH, MAX_HEIGHT, {
                        fit: 'inside',
                        withoutEnlargement: true,
                    })
                    .jpeg({ quality: QUALITY, mozjpeg: true })
                    .toBuffer();

                const base64 = `data:image/jpeg;base64,${optimized.toString('base64')}`;
                optimizedImages.set(url, base64);

                console.log(`[Image ${index + 1}] ✓ Optimized to ${(optimized.length / 1024).toFixed(2)}KB`);
            } catch (error) {
                console.error(`[Image ${index + 1}] ✗ Error processing:`, error instanceof Error ? error.message : error);
            }
        });

        await Promise.all(promises);
        processedCount += batch.length;

        console.log(`[Images] Progress: ${processedCount}/${imageUrls.length}`);
    }

    const duration = Date.now() - startTime;
    console.log(`[Images] Completed: ${optimizedImages.size}/${imageUrls.length} images in ${(duration / 1000).toFixed(2)}s`);

    if (optimizedImages.size < imageUrls.length) {
        console.warn(`[Images] Warning: ${imageUrls.length - optimizedImages.size} images failed to download`);
    }

    return optimizedImages;
}

export const makePDFFromDomain = async (url: string): Promise<Buffer> => {
    let browser;
    try {
        console.log(`[PDF] Starting generation for: ${url}`);
        const startTime = Date.now();
        
        browser = await getBrowser();
        const page = await browser.newPage();

        page.setDefaultTimeout(120000);
        page.setDefaultNavigationTimeout(120000);

        page.on("pageerror", (err) => {
            console.error("Page error:", err);
        });
        page.on("error", (err) => {
            console.error("Error:", err);
        });

        await page.setViewport({ width: 1080, height: 1024 });

        console.log(`[PDF] Loading page...`);
        
        await page.goto(url, {
            waitUntil: ["load", "domcontentloaded"],
            timeout: 90000,
        });

        console.log(`[PDF] Page loaded, fixing emoji rendering...`);
        
        // CONVERTER EMOJIS UNICODE PARA IMAGENS TWEMOJI
        await page.addScriptTag({
            url: 'https://cdn.jsdelivr.net/npm/@twemoji/api@latest/dist/twemoji.min.js'
        });
        
        await page.evaluate(() => {
            // Aplicar Twemoji
            if (typeof (window as any).twemoji !== 'undefined') {
                (window as any).twemoji.parse(document.body, {
                    folder: 'svg',
                    ext: '.svg'
                });
                console.log('Twemoji applied - emojis converted to images');
            }
            
            // CSS com controle de quebras de página
            const style = document.createElement('style');
            style.textContent = `
                @page {
                    size: A4;
                    margin: 15mm;
                }
                
                * {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif !important;
                }
                
                html, body {
                    margin: 0 !important;
                    padding: 0 !important;
                    width: 100% !important;
                }
                
                body, p, span, div, h1, h2, h3, h4, h5, h6, li, td, th {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif !important;
                    text-rendering: optimizeLegibility;
                    -webkit-font-smoothing: antialiased;
                    -moz-osx-font-smoothing: grayscale;
                }
                
                img.emoji {
                    height: 1em !important;
                    width: 1em !important;
                    margin: 0 0.05em 0 0.1em !important;
                    vertical-align: -0.1em !important;
                    display: inline !important;
                }
                
                .summary-icon img.emoji {
                    height: 1.5em !important;
                    width: 1.5em !important;
                }
                
                /* Controle inteligente de quebras de página */
                .talhao {
                    page-break-inside: avoid !important;
                    break-inside: avoid !important;
                    margin-bottom: 20px !important;
                }
                
                /* Imagens não devem quebrar */
                .gallery-image-wrapper, .image-wrapper {
                    page-break-inside: avoid !important;
                    break-inside: avoid !important;
                }
                
                /* Cabeçalho de talhão não deve ficar sozinho */
                .talhao-header, .talhao h2, .talhao h3 {
                    page-break-after: avoid !important;
                    break-after: avoid !important;
                }
                
                /* Evitar órfãos e viúvas */
                p, li {
                    orphans: 3;
                    widows: 3;
                }
                
                @media print {
                    * {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif !important;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    
                    img.emoji {
                        height: 1em !important;
                        width: 1em !important;
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

        await page.evaluateHandle('document.fonts.ready');
        await new Promise((resolve) => setTimeout(resolve, 2000));

        console.log(`[PDF] Scrolling through entire page...`);
        
        await page.evaluate(async () => {
            await new Promise<void>((resolve) => {
                let totalHeight = 0;
                const distance = 500;
                
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;

                    if (totalHeight >= scrollHeight) {
                        clearInterval(timer);
                        window.scrollTo(0, 0);
                        resolve();
                    }
                }, 100);
            });
        });

        console.log(`[PDF] Waiting for all images to load...`);
        
        await page.evaluate(async () => {
            const images = Array.from(document.querySelectorAll('img')) as HTMLImageElement[];
            
            await Promise.all(
                images.map((img, i) => {
                    if (img.complete && img.naturalHeight !== 0) {
                        return Promise.resolve();
                    }
                    
                    return new Promise<void>((resolve) => {
                        const timeout = setTimeout(() => {
                            console.warn(`Image ${i + 1} timeout`);
                            resolve();
                        }, 15000);
                        
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

        console.log(`[PDF] Adjusting image sizes for optimal layout...`);

        await page.evaluate(() => {
            // Ajustar tamanho das imagens para ficarem proporcionais
            const talhoes = document.querySelectorAll('.talhao');
            
            console.log(`Found ${talhoes.length} talhoes`);
            
            talhoes.forEach((talhao, index) => {
                const images = talhao.querySelectorAll('.gallery-image, .image-gallery img, img:not(.emoji)') as NodeListOf<HTMLImageElement>;
                
                if (images.length === 0) return;
                
                console.log(`Talhao ${index + 1}: ${images.length} images`);
                
                // Definir altura consistente para todas as imagens dentro de cada talhão
                const imageHeight = 350; // altura fixa em pixels
                
                images.forEach((img) => {
                    const wrapper = img.closest('.gallery-image-wrapper, .image-wrapper') as HTMLElement;
                    
                    if (wrapper) {
                        wrapper.style.height = `${imageHeight}px`;
                        wrapper.style.minHeight = `${imageHeight}px`;
                        wrapper.style.maxHeight = `${imageHeight}px`;
                        wrapper.style.display = 'flex';
                        wrapper.style.alignItems = 'center';
                        wrapper.style.justifyContent = 'center';
                        wrapper.style.overflow = 'hidden';
                        wrapper.style.margin = '10px 0';
                    }
                    
                    img.style.height = '100%';
                    img.style.width = '100%';
                    img.style.maxHeight = `${imageHeight}px`;
                    img.style.objectFit = 'contain';
                    img.style.objectPosition = 'center';
                });
            });
            
            const dynamicStyle = document.createElement('style');
            dynamicStyle.textContent = `
                .gallery-image-wrapper, .image-wrapper {
                    width: 100% !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    overflow: hidden !important;
                }
                
                .gallery-image, .image-gallery img {
                    object-fit: contain !important;
                    object-position: center !important;
                    image-orientation: from-image !important;
                }
            `;
            document.head.appendChild(dynamicStyle);
            
            console.log('Image sizing applied - all images normalized to 350px height');
        });

        console.log(`[PDF] Extracting image URLs...`);

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

        console.log(`[PDF] Found ${imageUrls.length} unique images to process`);

        if (imageUrls.length > 0) {
            const optimizedImages = await downloadAndOptimizeImages(imageUrls);

            console.log(`[PDF] Injecting ${optimizedImages.size} optimized images...`);

            await page.evaluate((imageMap: Record<string, string>) => {
                const images = Array.from(document.querySelectorAll('img:not(.emoji)')) as HTMLImageElement[];
                
                let replacedCount = 0;
                images.forEach(img => {
                    const optimizedSrc = imageMap[img.src];
                    if (optimizedSrc) {
                        img.src = optimizedSrc;
                        replacedCount++;
                    }
                });
                
                console.log(`Replaced ${replacedCount}/${images.length} images`);
            }, Object.fromEntries(optimizedImages));
        }

        console.log(`[PDF] Waiting for final render...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));

        console.log(`[PDF] Generating multi-page PDF with smart breaks...`);

        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
            preferCSSPageSize: true,
            displayHeaderFooter: false,
            scale: 1.0,
            timeout: 120000,
            omitBackground: false,
        });

        await browser.close();
        
        const duration = Date.now() - startTime;
        console.log(`[PDF] ✓ PDF generated in ${(duration / 1000).toFixed(2)}s`);
        
        return Buffer.from(pdf);
    } catch (error) {
        if (browser) {
            await browser.close();
        }
        console.error("PDF generation error:", error);
        throw error;
    }
};