import axios from 'axios';
import * as https from 'https';

export class URLValidator {
  async validate(validItems: any[]): Promise<{
    urlsChecked: number;
    successfulUrls: number;
    unsuccessfulUrls: number;
    issues: { item: any; error: string }[];
  }> {
    let urlsChecked = 0;
    let successfulUrls = 0;
    let unsuccessfulUrls = 0;
    const issues: { item: any; error: string }[] = [];

    const urlPromises = validItems.map(async (item) => {
      try {
        // Increment urlsChecked for every URL attempted
        urlsChecked++;
        // const response = await axios.get(item.url);
        // Disable SSL certificate validation for axios
        const response = await axios.get(item.url, {
          httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        });

        if (response.status === 200) {
          successfulUrls++;
        } else {
          unsuccessfulUrls++;
          issues.push({ item, error: `URL returned status ${response.status}` });
        }
      } catch (error) {
        unsuccessfulUrls++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        issues.push({ item, error: errorMessage });
      }
    });

    await Promise.all(urlPromises);

    return { urlsChecked, successfulUrls, unsuccessfulUrls, issues };
  }
}
