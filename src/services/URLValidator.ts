import axios from 'axios';
import * as https from 'https';
import { URLValidationItem, URLValidationIssue } from '../types/ValidationTypes';

export class URLValidator {
  async validate(validItems: URLValidationItem[]): Promise<{
    urlsChecked: number;
    successfulUrls: number;
    unsuccessfulUrls: number;
    issues: URLValidationIssue[];
  }> {
    let urlsChecked = 0;
    let successfulUrls = 0;
    let unsuccessfulUrls = 0;
    const issues: URLValidationIssue[] = [];

    const urlPromises = validItems.map(async (item) => {
      try {
        // Increment urlsChecked for every URL attempted
        urlsChecked++;
        // const response = await axios.get(item.url);
        // Disable SSL certificate validation for axios
        const response = await axios.get(item.url, {
          httpsAgent: new https.Agent({ rejectUnauthorized: false }),
          timeout: 4000,
        });

        if (response.status === 200) {
          successfulUrls++;
          console.log(`success ${item.url} is reachable, returned status: ${response.status}`);
        } else {
          unsuccessfulUrls++;
          const msg = `[ERROR] ${item.url} returned status ${response.status}`;
          console.error(msg);
          issues.push({ item, error: `URL returned status ${response.status}` });
        }
      } catch (error) {
        unsuccessfulUrls++;

        let errorMessage = 'error message';

        if (axios.isAxiosError(error)) {
          if (error.response) {
            errorMessage = `Server responded with status code ${error.response.status}`;
          } else if (error.request) {
            errorMessage = `No response received from the server, code: ${error.code}, message: ${error.message}`;
          } else {
            errorMessage = `Axios Error: ${error.message}`;
          }
        } else {
          errorMessage = 'Unknown error occurred.';
        }

        console.error(`error ${item.url} message: ${errorMessage}`);
        issues.push({ item, error: errorMessage });
      }
    });

    await Promise.all(urlPromises);
    console.log(
      `successful url's : ${successfulUrls} , unsuccessful url's: ${unsuccessfulUrls}, issues: ${issues.length}`,
    );

    return { urlsChecked: successfulUrls + unsuccessfulUrls, successfulUrls, unsuccessfulUrls, issues };
  }
}
/*
1  add method to review controller to catch the results that we have, map them to the database, catch specific for each item
2  add functionality into validation manager such that any errors caught can be sent
for getting specifc details will be applied such that each of the services sends individual data back to review controller.
*/
