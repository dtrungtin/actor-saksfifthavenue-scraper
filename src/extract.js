/* eslint-disable camelcase */
const Apify = require('apify');
const url = require('url');

function toMap(list) {
    const map = new Map();
    for (const item of list) {
        const key = item.id;
        map.set(key, item);
    }

    return map;
}

function extractData(request, html, $) {
    // <script type="application/json"></script>
    const scriptData1 = $('.framework-component script[type="application/json"]').text();
    const scriptData2 = $('.productDetail > script').text().replace('var pageData =', '').trim()
        .slice(0, -1);

    const json = JSON.parse(scriptData1);
    const pageJson = JSON.parse(scriptData2);
    const { protocol, pathname } = url.parse(request.url);
    const parts = pathname.split('/');
    const itemId = parts[3];
    const title = $('.product-overview__heading').text();
    const { designer } = pageJson.page;
    const { brand } = pageJson.products[0];

    const now = new Date();
    const { categories, colors, sizes, skus, media, description } = json.ProductDetails.main_products[0];
    const source = 'www.saksfifthavenue.com';

    const results = [];
    const imageUrlPrefix = protocol + media.images_server_url + media.images_path;
    const mediaImages = media.images;
    const sizeList = sizes ? sizes.sizes : [];
    const colorList = colors.colors;
    const skuList = skus.skus;
    const colorMap = toMap(colorList);
    const sizeMap = toMap(sizeList);
    const colorToAvailableSizes = new Map();
    const colorToSizes = new Map();
    const colorToPrice = new Map();

    for (const sku of skuList) {
        const { color_id, size_id, price, status_alias } = sku;
        if (color_id !== -1) {
            let relatedSizes = colorToSizes.get(color_id);
            if (!relatedSizes) {
                relatedSizes = [];
                colorToSizes.set(color_id, relatedSizes);
            }

            let relatedAvailableSizes = colorToAvailableSizes.get(color_id);
            if (!relatedAvailableSizes) {
                relatedAvailableSizes = [];
                colorToAvailableSizes.set(color_id, relatedAvailableSizes);
            }

            if (size_id !== -1) {
                const { is_soldout } = sizeMap.get(size_id);
                if (is_soldout === false) {
                    relatedAvailableSizes.push(size_id);
                    colorToAvailableSizes.set(color_id, relatedAvailableSizes);
                }

                relatedSizes.push(size_id);
                colorToSizes.set(color_id, relatedSizes);
            }

            colorToPrice.set(color_id, price);
        } else if (status_alias !== 'soldout') { // 'preorder', 'soldout', 'available', 'waitlist'
            // eslint-disable-next-line camelcase
            const { list_price, sale_price } = price;
            const listPrice = parseFloat(list_price.default_currency_value);
            const salePrice = parseFloat(sale_price.default_currency_value);
            const currency = list_price.local_currency_code;
            const images = [];
            for (const image of mediaImages) {
                images.push({ src: imageUrlPrefix + image });
            }

            const result = {
                url: request.url,
                categories,
                scrapedAt: now.toISOString(),
                title,
                description: description.replace(/<[^>]*>?/gm, ''),
                designer,
                itemId,
                color: '',
                price: listPrice,
                salePrice,
                currency,
                source,
                brand,
                images,
                composition: null,
                sizes: [],
                availableSizes: [],
                '#debug': Apify.utils.createRequestDebugInfo(request),
            };

            results.push(result);
        }
    }

    colorToPrice.forEach((value, key, map) => {
        const relatedSizes = colorToSizes.get(key);
        const relatedAvailableSizes = colorToAvailableSizes.get(key);
        const price = map.get(key);
        const color = colorMap.get(key);
        const { label, colorize_image_url, is_soldout } = color;

        if (is_soldout === false) {
            // eslint-disable-next-line camelcase
            const { list_price, sale_price } = price;
            const listPrice = parseFloat(list_price.default_currency_value);
            const salePrice = parseFloat(sale_price.default_currency_value);
            const currency = list_price.local_currency_code;
            const sizeValues = relatedSizes.map((sizeId) => { return sizeMap.get(sizeId).value; });
            const availableSizeValues = relatedAvailableSizes.map((sizeId) => { return sizeMap.get(sizeId).value; });
            const colorImageUrl = { src: imageUrlPrefix + colorize_image_url };
            const images = [];
            let found = false;
            for (const image of mediaImages) {
                if (image === colorize_image_url) {
                    found = true;
                }
                images.push({ src: imageUrlPrefix + image });
            }

            if (found === false) {
                images.push(colorImageUrl);
            }

            const result = {
                url: request.url.split('?')[0],
                categories,
                scrapedAt: now.toISOString(),
                title,
                description,
                designer,
                itemId,
                color: label,
                price: listPrice,
                salePrice,
                currency,
                source,
                brand,
                images,
                composition: null,
                sizes: sizeValues,
                availableSizes: availableSizeValues,
                '#debug': Apify.utils.createRequestDebugInfo(request),
            };

            results.push(result);
        }
    });

    return results;
}

module.exports = {
    extractData,
};
