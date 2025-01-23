import logger from '../utils/logger';
import { MetadataValidator } from './MetadataValidator';
import { URLValidator } from './URLValidator';
import { CategoryReport } from './CategoryReport';
import { Categorizer } from './Categorizer';
import { CategorizationResult } from '../types/ValidationTypes';

export class ValidationManager {
  private metadataValidator: MetadataValidator;
  private urlValidator: URLValidator;
  private categoryReport: CategoryReport;
  private categorizer: Categorizer;

  constructor() {
    this.metadataValidator = new MetadataValidator();
    this.urlValidator = new URLValidator();
    this.categoryReport = new CategoryReport();
    this.categorizer = new Categorizer();
  }

  async validateMetadata(jsonArray: any[]) {
    return this.metadataValidator.validate(jsonArray);
  }

  async validateUrls(validItems: any[]) {
    logger.info('Validating URLs...');
    return this.urlValidator.validate(validItems);
  }

  async generateCategoryReport(items: any[]) {
    logger.info('Generating category report...');
    const report = await this.categoryReport.generateReport(items);
    return report;
  }

  async storeAndClassifyItems(report: { matched: any[]; unclassified: any[]; unmatched: any[] }) {
    logger.info('Storing items and classifying...');
    const items = [...report.matched, ...report.unclassified, ...report.unmatched];
    await this.categorizer.storeItemsAndClassify(
      items.map((item) => item.item),
      report.matched,
    );
  }

  async fullValidationWorkflow(items: any[]) {
    // Validate metadata and extract the valid items
    const metadataResult = await this.validateMetadata(items);
    const validatedMetadataItems = metadataResult.validItems;

    // Validate URLs for the valid metadata items
    const urlValidationResult = await this.validateUrls(validatedMetadataItems);
    const successfulUrlItems = validatedMetadataItems.filter((_, index) => {
      return urlValidationResult.successfulUrls > index;
    });

    const report = await this.generateCategoryReport(successfulUrlItems);
    // Store and classify the items based on the report
    await this.storeAndClassifyItems(report);

    return {
      metadataValidated: validatedMetadataItems.length,
      urlsChecked: urlValidationResult.urlsChecked,
      urlsValidated: successfulUrlItems.length,
      reportSummary: {
        matched: report.matched.length,
        unclassified: report.unclassified.length,
        unmatched: report.unmatched.length,
      },
    };
  }
}
