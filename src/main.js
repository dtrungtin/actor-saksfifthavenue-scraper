/* eslint-disable camelcase */
const Apify = require('apify');
const safeEval = require('safe-eval');
const url = require('url');
const querystring = require('querystring');

const { extractData } = require('./extract');
const { delay, isObject } = require('./utils');

const { log } = Apify.utils;
log.setLevel(log.LEVELS.DEBUG);

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
        let startUrl = item.url;

        if (checkLimit()) {
            break;
        }

        if (startUrl.includes('saksfifthavenue.com')) {
            if (!startUrl.includes('www.saksfifthavenue.com')) {
                startUrl = startUrl.replace('saksfifthavenue.com', 'www.saksfifthavenue.com');
            }

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
            } else if (startUrl.includes('SectionPage.jsp')) {
                await requestQueue.addRequest({ url: startUrl, userData: { label: 'section' } });
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

            if (body.includes('Access Denied')) {
                throw new Error('We got blocked, to ensure stable run, use only SHADER proxy group');
            }

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
                    const shopUrl = `${WEBSITE}${href}`;

                    if (href.includes('/shop/')) {
                        await requestQueue.addRequest({ url: shopUrl, userData: { label: 'shop' } });
                    } else if (href.includes('SectionPage.jsp')) {
                        await requestQueue.addRequest({ url: shopUrl, userData: { label: 'section' } });
                    }
                    await delay(5000);
                }
            } else if (request.userData.label === 'section') {
                if (checkLimit()) {
                    return;
                }

                const shopLinks = $('.url-link');
                for (let index = 0; index < shopLinks.length; index++) {
                    if (checkLimit()) {
                        break;
                    }

                    const href = $(shopLinks[index]).attr('href');
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
