const { KeyValueStore, log } = require('apify');

async function loadCookies(page) {
    const store = await KeyValueStore.open('COOKIE_STORE');
    const cookies = await store.getValue('APOLLO_COOKIES');
    if (cookies && cookies.length) {
        await page.setCookie(...cookies);
        log.info(`🗝️ Loaded ${cookies.length} cookies.`);
    } else {
        log.warning('No saved cookies found. Login required.');
    }
}

module.exports = { loadCookies };
