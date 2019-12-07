### Saksfifthavenue Scraper

Saksfifthavenue Scraper is an [Apify actor](https://apify.com/actors) for extracting data about actors from [Saksfifthavenue](https://www.saksfifthavenue.com/). It allows you to extract all products. It is build on top of [Apify SDK](https://sdk.apify.com/) and you can run it both on [Apify platform](https://my.apify.com) and locally.

- [Input](#input)
- [Output](#output)
- [Compute units consumption](#compute-units-consumption)
- [Extend output function](#extend-output-function)

### Input

| Field | Type | Description | Default value
| ----- | ---- | ----------- | -------------|
| startUrls | array | List of [Request](https://sdk.apify.com/docs/api/request#docsNav) objects that will be deeply crawled. The URL can be home page like `https://www.saksfifthavenue.com/` or category page `https://www.saksfifthavenue.com/Shoes/New-Arrivals/shop/_/N-52kjc7/Ne-6lvnb5` or detail page `https://www.saksfifthavenue.com/christian-louboutin-levitibootie-leather-ankle-boots/product/0400011330427`. | `[{ "url": "https://www.saksfifthavenue.com/" }]`|
| maxItems | number | Maximum number of actor pages that will be scraped | all found |
| extendOutputFunction | string | Function that takes a Cheerio handle ($) as argument and returns data that will be merged with the result output. More information in [Extend output function](#extend-output-function) | |
| proxyConfiguration | object | Proxy settings of the run. This actor works better with the Apify proxy group SHADER. If you have access to Apify proxy, leave the default settings. If not, you can use other Apify proxy groups or you can set `{ "useApifyProxy": false" }` to disable proxy usage | `{ "useApifyProxy": true, "apifyProxyGroups": ["SHADER"] }`|

### Output

Output is stored in a dataset. Each item is an information about a product. Example:

```
{
  "url": "https://www.saksfifthavenue.com/christian-louboutin-loubileopard-metallic-eye-color/product/0400011810091",
  "categories": [
    "SaksBeautyPlace/ForHer/Color/Eyes/PowderShadow"
  ],
  "scrapedAt": "2019-11-30T11:12:10.245Z",
  "title": "Christian Louboutin",
  "description": "Loubiléopard Metallic Eye Color",
  "designer": "christian louboutin",
  "itemId": "0400011810091",
  "color": "Priyado",
  "price": 50,
  "salePrice": 50,
  "currency": "USD",
  "source": "www.saksfifthavenue.com",
  "brand": "christian louboutin",
  "images": [
    {
      "src": "https://image.s5a.com/is/image/saks/0400011810091"
    }
  ],
  "composition": null,
  "sizes": [],
  "availableSizes": []
}
```

### Compute units consumption
Keep in mind that it is much more efficient to run one longer scrape (at least one minute) than more shorter ones because of the startup time.

The average consumption is **0.4 Compute unit for 1000 actor pages** scraped

### Extend output function

You can use this function to update the result output of this actor. This function gets a Cheerio handle `$` as an argument so you can choose what data from the page you want to scrape. The output from this will function will get merged with the result output.

The return value of this function has to be an object!

You can return fields to achive 3 different things:
- Add a new field - Return object with a field that is not in the result output
- Change a field - Return an existing field with a new value
- Remove a field - Return an existing field with a value `undefined`


```
($) => {
    return {
        "promoMessage": $('.product__promo-message').text().trim(),
        "salePrice": 0,
        url: undefined
    }
}
```
This example will add a new field `promoMessage`, change the `salePrice` field and remove `url` field
```
{
  "promoMessage": "$50-$750 GIFT CARD WITH CODE GIVE19SF",
  "categories": [
    "SaksBeautyPlace/ForHer/Color/Eyes/PowderShadow"
  ],
  "scrapedAt": "2019-11-30T11:12:10.245Z",
  "title": "Christian Louboutin",
  "description": "Loubiléopard Metallic Eye Color",
  "designer": "christian louboutin",
  "itemId": "0400011810091",
  "color": "Priyado",
  "price": 50,
  "salePrice": 0,
  "currency": "USD",
  "source": "www.saksfifthavenue.com",
  "brand": "christian louboutin",
  "images": [
    {
      "src": "https://image.s5a.com/is/image/saks/0400011810091"
    }
  ],
  "composition": null,
  "sizes": [],
  "availableSizes": []
}
```

### Epilogue
Thank you for trying my actor. I will be very glad for a feedback that you can send to my email `dtrungtin@gmail.com`. If you find any bug, please create an issue on the [Github page](https://github.com/dtrungtin/actor-saksfifthavenue-scraper).