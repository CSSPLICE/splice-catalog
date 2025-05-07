import puppeteer from 'puppeteer';

export async function runIframeValidation(iframeUrl: string): Promise<{ passed: boolean; message?: string }> {
  const validatorPageUrl = `http://localhost:3000/iframeValidator.html?iframe=${encodeURIComponent(iframeUrl)}`;

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  let result: { passed: boolean; message?: string } = { passed: false };

  try {
    await page.goto(validatorPageUrl, { waitUntil: 'networkidle2', timeout: 15000 });

    const checkResult = await page.evaluate(() => {
      return new Promise<{ passed: boolean; message?: string }>((resolve) => {
        const statusDiv = document.getElementById('status');

        if (!statusDiv) return resolve({ passed: false, message: 'No status element found' });

        const maxWaitTime = 8000;
        const pollInterval = 500;
        let elapsed = 0;

        const poll = setInterval(() => {
          const statusText = statusDiv.textContent || '';
          if (statusText.includes('Passed')) {
            clearInterval(poll);
            resolve({ passed: true, message: statusText });
          } else if (statusText.includes('Failed')) {
            clearInterval(poll);
            resolve({ passed: false, message: statusText });
          }

          elapsed += pollInterval;
          if (elapsed >= maxWaitTime) {
            clearInterval(poll);
            resolve({ passed: false, message: 'Timeout waiting for validation result' });
          }
        }, pollInterval);
      });
    });

    result = checkResult;
  } catch (err: any) {
    result = { passed: false, message: `Error during Puppeteer run: ${err.message}` };
  } finally {
    await browser.close();
  }

  return result;
}
