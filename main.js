const { Actor, log, ProxyConfiguration, KeyValueStore } = require('apify');
const puppeteer = require('puppeteer');
const { loadCookies } = require('./utils');

Actor.main(async () => {
    const input = await Actor.getInput();
    const {
    country,
    region,
    companySizes: companySizesRaw = '11-50,51-200',
    onlyValidEmails = true
} = input;

const companySizes = companySizesRaw.split(',').map(s => s.trim());

    const proxyConfiguration = await Actor.createProxyConfiguration({
        groups: ['RESIDENTIAL'],
    });

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox'],
    });

    const page = await browser.newPage();
    await Actor.utils.puppeteer.setProxyToPage(page, proxyConfiguration);

    await loadCookies(page);
    await page.goto('https://app.apollo.io/#/dashboard', { waitUntil: 'networkidle2' });
    if (page.url().includes('/login')) {
        log.info('🔑 Please log in to Apollo.io manually within 60 seconds...');
        await page.waitForTimeout(60000);
        const cookies = await page.cookies();
        const store = await KeyValueStore.open('COOKIE_STORE');
        await store.setValue('APOLLO_COOKIES', cookies);
        log.info('✅ Session cookies saved.');
    }

    const jobTitles = ['Payroll Officer', 'Accountant', 'HR Assistant', 'Data Entry Clerk'];
    const chosenJob = jobTitles[Math.floor(Math.random() * jobTitles.length)];
    log.info(`🔍 Searching for: ${chosenJob}`);

    const location = encodeURIComponent(region ? `${region}, ${country}` : country);
    const sizeParams = companySizes.map(size => `organization_num_employees_ranges[]=${encodeURIComponent(size)}`).join('&');
    const searchUrl = `https://app.apollo.io/#/people?person_titles[]=${encodeURIComponent(chosenJob)}&person_locations[]=${location}&${sizeParams}`;

    await page.goto(searchUrl, { waitUntil: 'networkidle2' });

    const results = [];
    let pageNum = 1;

    while (true) {
        log.info(`📄 Scraping page ${pageNum}...`);
        try {
            await page.waitForSelector('.search-result__profile-card', { timeout: 15000 });

            const pageResults = await page.evaluate((onlyValidEmails) => {
                const items = [];
                document.querySelectorAll('.search-result__profile-card').forEach((card) => {
                    const name = card.querySelector('.profile-name')?.innerText?.trim();
                    const title = card.querySelector('.text-truncate')?.innerText?.trim();
                    const company = card.querySelector('.company-name')?.innerText?.trim();
                    const email = card.querySelector('.email')?.innerText?.trim();

                    if (!name || !title) return;
                    const lowered = title.toLowerCase();
                    if (/manager|director|executive|chief|lead/.test(lowered)) return;
                    if (!email || (onlyValidEmails && email.includes('Catch-all'))) return;

                    items.push({ name, title, company, email });
                });
                return items;
            }, onlyValidEmails);

            results.push(...pageResults);

            const next = await page.$('button.pagination-next');
            if (next) {
                await next.click();
                await page.waitForTimeout(4000);
                pageNum++;
            } else break;
        } catch (e) {
            log.warning('⚠️ Pagination ended or error occurred.');
            break;
        }
    }

    // ===== Final Output: Flat with separator lines =====
    const output = [];

    for (let i = 0; i < results.length - 1; i++) {
        const payroll = results[i];
        const random = results[i + 1];

        if (payroll.title.toLowerCase().includes('payroll') && payroll.email) {
            if (
                random.title.toLowerCase().includes('payroll') ||
                payroll.name === random.name
            ) continue;

            output.push(
                `${payroll.name}\n${payroll.email}\n${random.name}\n${random.title}\n=============================================`
            );

            i++; // Skip next to avoid repeating
        }
    }

    await Actor.pushData(output);
    log.info(`✅ Finished. Output records: ${output.length}`);

    await browser.close();
});
