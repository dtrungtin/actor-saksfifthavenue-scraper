/* eslint-disable camelcase */
const Apify = require('apify');
const safeEval = require('safe-eval');
const url = require('url');
const querystring = require('querystring');

const { log } = Apify.utils;
log.setLevel(log.LEVELS.DEBUG);

function delay(time) {
    return new Promise(((resolve) => {
        setTimeout(resolve, time);
    }));
}

function toMap(list) {
    const map = new Map();
    for (const item of list) {
        const key = item.id;
        map.set(key, item);
    }

    return map;
}

const isObject = val => typeof val === 'object' && val !== null && !Array.isArray(val);

function extractData(request, html, $) {
    // <script type="application/json"></script>
    const scriptData1 = $('.framework-component script[type="application/json"]').text();
    const scriptData2 = $('.productDetail > script').text().replace('var pageData =', '').trim()
        .slice(0, -1);

    if (scriptData1 === '' || scriptData2 === '') {
        log.debug('Html: ', html);
    }

    const json = JSON.parse(scriptData1);
    const pageJson = JSON.parse(scriptData2);
    const { pathname } = url.parse(request.url);
    const parts = pathname.split('/');
    const itemId = parts[3];
    const title = $('.product-overview__heading').text();
    const description = $('.product-overview__short-description').text();
    const { designer } = pageJson.page;
    const { brand } = pageJson.products[0];

    const now = new Date();
    const { categories, colors, sizes, skus } = json.ProductDetails.main_products[0];
    const source = 'www.saksfifthavenue.com';

    const results = [];
    const sizeList = sizes ? sizes.sizes : [];
    const colorList = colors.colors;
    const skuList = skus.skus;
    const colorMap = toMap(colorList);
    const sizeMap = toMap(sizeList);
    const colorToSizes = new Map();
    const colorToPrice = new Map();

    for (const sku of skuList) {
        const { color_id, size_id, price } = sku;
        if (color_id !== -1) {
            let relatedSizes = colorToSizes.get(color_id);
            if (!relatedSizes) {
                relatedSizes = [];
                colorToSizes.set(color_id, relatedSizes);
            }

            if (size_id !== -1) {
                relatedSizes.push(size_id);
                colorToSizes.set(color_id, relatedSizes);
            }

            colorToPrice.set(color_id, price);
        } else {
            // eslint-disable-next-line camelcase
            const { list_price, sale_price } = price;
            const listPrice = parseFloat(list_price.default_currency_value);
            const salePrice = parseFloat(sale_price.default_currency_value);
            const currency = list_price.local_currency_code;

            const result = {
                url: request.url,
                scrapedAt: now.toISOString(),
                source,
                title,
                description,
                itemId,
                color: '',
                brand,
                designer,
                categories,
                sizes: [],
                price: listPrice,
                salePrice,
                currency,
                '#debug': Apify.utils.createRequestDebugInfo(request),
            };

            results.push(result);
        }
    }

    colorToPrice.forEach((value, key, map) => {
        const relatedSizes = colorToSizes.get(key);
        const price = map.get(key);

        // eslint-disable-next-line camelcase
        const { list_price, sale_price } = price;
        const listPrice = parseFloat(list_price.default_currency_value);
        const salePrice = parseFloat(sale_price.default_currency_value);
        const currency = list_price.local_currency_code;
        const color = colorMap.get(key).label;
        const sizeValues = relatedSizes.map((sizeId) => { return sizeMap.get(sizeId).value; });

        const result = {
            url: request.url,
            scrapedAt: now.toISOString(),
            source,
            title,
            description,
            itemId,
            color,
            brand,
            designer,
            categories,
            sizes: sizeValues,
            price: listPrice,
            salePrice,
            currency,
            '#debug': Apify.utils.createRequestDebugInfo(request),
        };

        results.push(result);
    });

    return results;
}

let detailsEnqueued = 0;

Apify.events.on('migrating', async () => {
    await Apify.setValue('detailsEnqueued', detailsEnqueued);
});

const WEBSITE = 'https://www.saksfifthavenue.com';

Apify.main(async () => {
    const input = await Apify.getInput();
    log.info('Input:', input);

    const { startUrls, maxItems, extendOutputFunction, proxyConfiguration } = input;

    if (!input || !Array.isArray(input.startUrls) || input.startUrls.length === 0) {
        throw new Error("Invalid input, it needs to contain at least one url in 'startUrls'.");
    }

    let extendOutputFunctionObj;
    if (typeof extendOutputFunction === 'string' && extendOutputFunction.trim() !== '') {
        try {
            extendOutputFunctionObj = safeEval(extendOutputFunction);
        } catch (e) {
            throw new Error(`'extendOutputFunction' is not valid Javascript! Error: ${e}`);
        }
        if (typeof extendOutputFunctionObj !== 'function') {
            throw new Error('extendOutputFunction is not a function! Please fix it or use just default ouput!');
        }
    }

    let proxyConf = {
        useApifyProxy: true,
        apifyProxyGroups: ['SHADER'],
    };

    if (proxyConfiguration) proxyConf = proxyConfiguration;

    const requestQueue = await Apify.openRequestQueue();

    detailsEnqueued = await Apify.getValue('detailsEnqueued');
    if (!detailsEnqueued) {
        detailsEnqueued = 0;
    }

    function checkLimit() {
        return maxItems && detailsEnqueued >= maxItems;
    }

    for (const item of startUrls) {
        const startUrl = item.url;

        if (checkLimit()) {
            break;
        }

        if (startUrl.includes(WEBSITE)) {
            if (startUrl.includes('/product/')) {
                const { pathname } = url.parse(startUrl);
                const parts = pathname.split('/');
                const itemId = parts[3];
                const { wasAlreadyPresent, wasAlreadyHandled } = await requestQueue.addRequest(
                    { url: startUrl, uniqueKey: itemId, userData: { label: 'item' } },
                    { forefront: true },
                );
                if (!wasAlreadyPresent && !wasAlreadyHandled) {
                    detailsEnqueued++;
                }
            } else if (startUrl.includes('/shop/')) {
                await requestQueue.addRequest({ url: startUrl, userData: { label: 'shop' } });
            } else {
                await requestQueue.addRequest({ url: startUrl, userData: { label: 'home' } });
            }
        }
    }

    const crawler = new Apify.CheerioCrawler({
        requestQueue,

        minConcurrency: 10,
        maxConcurrency: 50,
        maxRequestRetries: 2,
        handlePageTimeoutSecs: 1800,

        handlePageFunction: async ({ request, body, $ }) => {
            log.info(`Processing ${request.url}...`);

            if (request.userData.label === 'home') {
                if (checkLimit()) {
                    return;
                }

                const allCategoryLinks = $('a.nav_link');

                for (let index = 0; index < allCategoryLinks.length; index++) {
                    if (checkLimit()) {
                        return;
                    }

                    const href = $(allCategoryLinks[index]).attr('href');
                    if (href.includes('/shop/')) {
                        const shopUrl = `${WEBSITE}${href}`;
                        await requestQueue.addRequest({ url: shopUrl, userData: { label: 'shop' } });
                        await delay(5000);
                    }
                }
            } else if (request.userData.label === 'shop') {
                if (checkLimit()) {
                    return;
                }

                const totalNumberOfPagesEle = $('#pc-top .totalNumberOfPages');
                if (!totalNumberOfPagesEle || totalNumberOfPagesEle.text() === '') {
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

                const pageCount = totalNumberOfPagesEle.text().trim();
                const perPage = itemLinks.length;

                if (pageCount > 1) {
                    const index = 1;
                    const startNumber = index * perPage;
                    let startUrl = request.url;
                    startUrl += `${startUrl.includes('?') ? '&' : '?'}Nao=${startNumber}`;
                    await requestQueue.addRequest({ url: startUrl,
                        userData: { label: 'list', current: index, total: pageCount, perPage } });
                }
            } else if (request.userData.label === 'list') {
                if (checkLimit()) {
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

                const index = request.userData.current + 1;
                const pageCount = request.userData.total;
                const { perPage } = request.userData;

                if (index < pageCount) {
                    const startNumber = index * perPage;
                    const arr = request.url.split('?');
                    let startUrl = arr[0];
                    let query = arr[1];
                    const params = querystring.parse(query);
                    params.Nao = startNumber;
                    query = querystring.stringify(params);
                    startUrl = `${startUrl}?${query}`;

                    await requestQueue.addRequest({ url: startUrl,
                        userData: { label: 'list', current: index, total: pageCount, perPage } });
                }
            } else if (request.userData.label === 'item') {
                const pageResults = extractData(request, body, $);
                let userResult;

                if (extendOutputFunction) {
                    userResult = await extendOutputFunctionObj($);

                    if (!isObject(userResult)) {
                        log.error('extendOutputFunction has to return an object!!!');
                        process.exit(1);
                    }
                }

                for (let pageResult of pageResults) {
                    if (userResult) {
                        pageResult = Object.assign(pageResult, userResult);
                    }

                    await Apify.pushData(pageResult);
                }
            }
        },

        // This function is called if the page processing failed more than maxRequestRetries+1 times.
        handleFailedRequestFunction: async ({ request }) => {
            log.info(`Request ${request.url} failed twice.`);
        },

        ...proxyConf,
    });

    // Run the crawler and wait for it to finish.
    await crawler.run();

    log.info('Crawler finished.');
});
