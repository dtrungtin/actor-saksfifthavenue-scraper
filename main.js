const Apify = require('apify');
const _ = require('underscore');
const safeEval = require('safe-eval');

const { log } = Apify.utils;
log.setLevel(log.LEVELS.WARNING);

function delay(time) {
    return new Promise(((resolve) => {
        setTimeout(resolve, time);
    }));
}

const isObject = val => typeof val === 'object' && val !== null && !Array.isArray(val);

let detailsEnqueued = 0;

Apify.events.on('migrating', async () => {
    await Apify.setValue('detailsEnqueued', detailsEnqueued);
});

Apify.main(async () => {
    const input = await Apify.getInput();
    console.log('Input:');
    console.dir(input);

    if (!input || !Array.isArray(input.startUrls) || input.startUrls.length === 0) {
        throw new Error("Invalid input, it needs to contain at least one url in 'startUrls'.");
    }

    let extendOutputFunction;
    if (typeof input.extendOutputFunction === 'string' && input.extendOutputFunction.trim() !== '') {
        try {
            extendOutputFunction = safeEval(input.extendOutputFunction);
        } catch (e) {
            throw new Error(`'extendOutputFunction' is not valid Javascript! Error: ${e}`);
        }
        if (typeof extendOutputFunction !== 'function') {
            throw new Error('extendOutputFunction is not a function! Please fix it or use just default ouput!');
        }
    }

    const requestQueue = await Apify.openRequestQueue();

    detailsEnqueued = await Apify.getValue('detailsEnqueued');
    if (!detailsEnqueued) {
        detailsEnqueued = 0;
    }

    function checkLimit() {
        return input.maxItems && detailsEnqueued >= input.maxItems;
    }

    for (const item of input.startUrls) {
        const startUrl = item.url;

        if (checkLimit()) {
            break;
        }

        if (startUrl.includes('https://www.saksfifthavenue.com')) {
            if (startUrl.includes('productpage')) {
                await requestQueue.addRequest({ url: startUrl, userData: { label: 'item' } });
                detailsEnqueued++;
            } else {
                await requestQueue.addRequest({ url: startUrl, userData: { label: 'start' } });
            }
        }
    }

    const crawler = new Apify.CheerioCrawler({
        requestQueue,

        minConcurrency: 2,
        maxConcurrency: 5,
        maxRequestRetries: 1,
        handlePageTimeoutSecs: 60,

        handlePageFunction: async ({ request, body, $ }) => {
            await delay(1000);
            console.log(`Processing ${request.url}...`);

            if (request.userData.label === 'start') {
                const paginationEle = $('#pc-top .totalRecords');
                if (!paginationEle || paginationEle.text() === '') {
                    return;
                }

                const itemLinks = $('.product-text a');
                for (let index = 0; index < itemLinks.length; index++) {
                    if (checkLimit()) {
                        break;
                    }

                    const href = $(itemLinks[index]).attr('href');

                    await requestQueue.addRequest({ url: `${href}`, userData: { label: 'item' } },
                        { forefront: true });
                    detailsEnqueued++;    
                }

                const pageCount = Math.floor(parseInt(paginationEle.text(), 10) / 150); // Each page has 150 items

                if (pageCount > 0) {
                    const index = 1;
                    const startNumber = index * 150;
                    let startUrl = request.url;
                    startUrl += `${startUrl.split('?')[1] ? '&' : '?'}Nao=${startNumber}`;
                    await requestQueue.addRequest({ url: startUrl, userData: { label: 'list', current: index, total: pageCount } });
                }
            } else if (request.userData.label === 'list') {
                const itemLinks = $('.product-text a');
                for (let index = 0; index < itemLinks.length; index++) {
                    if (checkLimit()) {
                        break;
                    }

                    const href = $(itemLinks[index]).attr('href');

                    await requestQueue.addRequest({ url: `${href}`, userData: { label: 'item' } },
                        { forefront: true });
                    detailsEnqueued++;    
                }

                const index = request.userData.current + 1;
                const pageCount = request.userData.total;

                if (index < pageCount) {
                    const startNumber = index * 150;
                    let startUrl = request.url;
                    startUrl += `${startUrl.split('?')[1] ? '&' : '?'}Nao=${startNumber}`;
                    await requestQueue.addRequest({ url: startUrl, userData: { label: 'list', current: index, total: pageCount } });
                }
            } else if (request.userData.label === 'item') {
                const itemId = $('.fp-root').attr('data-product-id');
                const name = $('.product-overview__heading').text();
                const description = $('.product-overview__short-description').text();
                const price = $('.product-pricing__price').text();
                const color = $('.product-variant-attribute-label__selected-value').text();
                const sizes = [];
                $('.product-variant-attribute-values li').each((i,op) => {
                    sizes.push($(op).text().trim());
                });

                const pageResult = {
                    url: request.url,
                    name,
                    description,
                    itemId,
                    color,
                    sizes,
                    price,
                    '#debug': Apify.utils.createRequestDebugInfo(request),
                };

                if (extendOutputFunction) {
                    const userResult = await extendOutputFunction($);

                    if (!isObject(userResult)) {
                        console.log('extendOutputFunction has to return an object!!!');
                        process.exit(1);
                    }

                    _.extend(pageResult, userResult);
                }

                await Apify.pushData(pageResult);
            }
        },

        // This function is called if the page processing failed more than maxRequestRetries+1 times.
        handleFailedRequestFunction: async ({ request }) => {
            console.log(`Request ${request.url} failed twice.`);
        },

        ...input.proxyConfiguration,
    });

    // Run the crawler and wait for it to finish.
    await crawler.run();

    console.log('Crawler finished.');
});
