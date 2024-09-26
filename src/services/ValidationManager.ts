import logger from '../utils/logger';
import { MetadataValidator } from './MetadataValidator';
import { URLValidator } from './URLValidator';

export class ValidationManager {
  private metadataValidator: MetadataValidator;
  private urlValidator: URLValidator;

  constructor() {
    this.metadataValidator = new MetadataValidator();
    this.urlValidator = new URLValidator();
  }

  validateMetadata(jsonArray: any[]) {
    return this.metadataValidator.validate(jsonArray);
  }

  async validateUrls(validItems: any[]) {
    logger.info("data reached here")
    return this.urlValidator.validate(validItems);
  }
}
