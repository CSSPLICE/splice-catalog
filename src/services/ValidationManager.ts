import logger from '../utils/logger';
import { MetadataValidator } from './MetadataValidator';
import { URLValidator } from './URLValidator';
import { CategoryReport } from './CategoryReport';
import { Categorizer } from './Categorizer';
import { MetadataIssue, URLValidationResult } from '../types/ValidationTypes';
import { SLCItem } from '../types/ItemTypes';
import { CreateSLCItemDTO } from '../dtos/SLCItemDTO';
import { CategorizationReport } from '../types/CategorizationTypes';
import { Repository } from "typeorm";
import { ValidationResults } from "../db/entities/ValidationResults";

export class ValidationManager {
  private metadataValidator: MetadataValidator;
  private urlValidator: URLValidator;
  private categoryReport: CategoryReport;
  private categorizer: Categorizer;
  private validationResultsRepository: Repository<ValidationResults>;

  constructor(validationResultsRepository: Repository<ValidationResults>) {
    this.metadataValidator = new MetadataValidator();
    this.urlValidator = new URLValidator();
    this.categoryReport = new CategoryReport();
    this.categorizer = new Categorizer();
    this.validationResultsRepository = validationResultsRepository;
  }
  
async saveValidationResult(result: Partial<ValidationResults>): Promise<void> {
  try {
    const newValidationResult = this.validationResultsRepository.create(result);
    await this.validationResultsRepository.save(newValidationResult);
    logger.info('Validation result saved successfully:', newValidationResult);
  } catch (error) {
    logger.error('Error saving validation result:', error);
    throw error;
  }
}

  /**
   * Validates metadata items and returns the result.
   * @param jsonArray - Array of SLCItems to validate
   * @returns Metadata validation result
   */
  async validateMetadata(jsonArray: SLCItem[]): Promise<{
    issues: MetadataIssue[];
    validItems: SLCItem[];
    totalSubmissions: number;
    successfulVerifications: number;
  }> {
    try {
      logger.info(`Starting metadata validation for ${jsonArray.length} items`);

      // 1. Transform SLCItem[] -> CreateSLCItemDTO[]
      const createDtoArray: CreateSLCItemDTO[] = jsonArray.map((item) => ({
        ...item,
        keywords: item.keywords ?? [], // Ensure keywords is string[]
        lti_instructions_url: item.lti_instructions_url ?? '',
      }));

      // 2. Validate the CreateSLCItemDTO[] array
      const result = await this.metadataValidator.validate(createDtoArray);

      // Save validation results for each item
      for (const item of jsonArray) {
        const metadataIssues = result.issues.find((issue) => issue.item.exercise_name === item.exercise_name
        )?.validationErrors || null;
        const validationResult = {
          user: 'persistent user id?', // persistent identifier?
          dateLastUpdated: new Date(),
          metadataIssues: metadataIssues ? JSON.stringify(metadataIssues) : undefined, //errors into strings
          validationStatus: metadataIssues ? 'failed' : 'success',
        };
        
        await this.saveValidationResult(validationResult);
      }
      logger.info(`Metadata validation completed: ${result.validItems.length} valid items`);
      //logger.info(); print the validation results
      const validSLCItems: SLCItem[] = result.validItems.map((dto) => ({
        ...dto,

        keywords: dto.keywords ?? [],
        lti_instructions_url: dto.lti_instructions_url || undefined,
      }));

      return {
        issues: result.issues,
        validItems: validSLCItems,
        totalSubmissions: result.totalSubmissions,
        successfulVerifications: result.successfulVerifications,
      };
    } catch (error) {
      logger.error('Error in metadata validation:', error);
      throw error;
    }
  }

  /**
   * Validates URLs for valid metadata items.
   * @param validItems - Array of valid SLCItems
   * @returns URL validation result
   */
  async validateUrls(validItems: SLCItem[]): Promise<URLValidationResult> {
    try {
      logger.info(`Starting URL validation for ${validItems.length} items`);
      const result = await this.urlValidator.validate(validItems);
          // Save individual URL validation results into the database
      for (const [index, item] of validItems.entries()) {
        const isValid = result.successfulUrls > index;
        const validationResult = {
          user: 'currentUser', // Replace with actual user identifier
          dateLastUpdated: new Date(),
          isUrlValid: isValid,
          metadataIssues: undefined, // No metadata issues here
          validationStatus: isValid ? 'success' : 'failed',
      };
      await this.saveValidationResult(validationResult); // Save results to the database
    }
      logger.info(`URL validation completed: ${result.successfulUrls} successful URLs`);
      return result;
    } catch (error) {
      logger.error('Error in URL validation:', error);
      throw error;
    }
  }

  /**
   * Generates a category report for given items.
   * @param items - Array of items to classify
   * @returns Categorization report with matched/unclassified/unmatched
   */
  async generateCategoryReport(items: SLCItem[]): Promise<CategorizationReport> {
    try {
      logger.info(`Generating category report for ${items.length} items`);
      const report = await this.categoryReport.generateReport(items);

      logger.info('Category report generated successfully:', {
        matched: report.matched.length,
        unclassified: report.unclassified.length,
        unmatched: report.unmatched.length,
      });

      return report;
    } catch (error) {
      logger.error('Error generating category report:', error);
      throw error;
    }
  }

  /**
   * Stores items in the catalog and classifies them.
   * @param report - Categorization report containing matched, unclassified, and unmatched items
   */
  async storeAndClassifyItems(report: CategorizationReport): Promise<void> {
    try {
      logger.info('Starting items storage and classification');
      const items = [...report.matched, ...report.unclassified, ...report.unmatched];

      if (!items.length) {
        const error = new Error('No items to process');
        logger.error(error.message);
        throw error;
      }

      // The categorizer expects an array of SLCItems and matched items
      const itemsToProcess: SLCItem[] = items.map((obj) => obj.item);
      await this.categorizer.storeItemsAndClassify(itemsToProcess, report.matched);
      logger.info(`Successfully stored and classified ${items.length} items`);
    } catch (error) {
      logger.error('Failed to store and classify items:', error);
      throw error;
    }
  }

  /**
   * Executes the full validation workflow: metadata validation, URL validation, categorization, and storing results.
   * @param items - Array of SLCItems to process
   * @returns Summary of the validation process
   */
  async fullValidationWorkflow(items: SLCItem[]): Promise<{
    metadataValidated: number;
    urlsChecked: number;
    urlsValidated: number;
    reportSummary: {
      matched: number;
      unclassified: number;
      unmatched: number;
    };
  }> {
    try {
      if (!items?.length) {
        throw new Error('No items provided for validation');
      }

      logger.info(`Starting full validation workflow for ${items.length} items`);

      // Step 1: Metadata Validation
      const metadataResult = await this.validateMetadata(items);
      const validatedMetadataItems = metadataResult.validItems;

      if (!validatedMetadataItems.length) {
        throw new Error('No items passed metadata validation');
      }

      // Step 2: URL Validation
      const urlValidationResult = await this.validateUrls(validatedMetadataItems);
      const successfulUrlItems = validatedMetadataItems.filter(
        (_, index) => urlValidationResult.successfulUrls > index,
      );

      if (!successfulUrlItems.length) {
        throw new Error('No items passed URL validation');
      }

      // Step 3: Category Report Generation
      const report = await this.generateCategoryReport(successfulUrlItems);

      // Step 4: Store and Classify
      await this.storeAndClassifyItems(report);

      // Return summary
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
    } catch (error) {
      logger.error('Error in validation workflow:', error);
      throw error;
    }
  }
}
