import { AppDataSource } from '../db/data-source';
import { OntologyClasses } from '../db/entities/OntologyClass';
import { OntologyAliases } from '../db/entities/OntologyAlias';
import logger from '../utils/logger';

export class KeywordMatch {
  private ontologyRepo = AppDataSource.getRepository(OntologyClasses);
  private aliasRepo = AppDataSource.getRepository(OntologyAliases);

  public async matchKeywordsToOntology(metadata: any) {
    const matchedClasses = [];

    logger.info('Starting keyword matching for:', metadata.keywords);

    for (const keyword of metadata.keywords) {
      logger.info(`Attempting to match keyword: ${keyword}`);

      const classMatch = await this.ontologyRepo
        .createQueryBuilder('oc')
        .where('oc.label LIKE :keyword', { keyword: `%${keyword}%` })
        .getOne();

      if (classMatch) {
        matchedClasses.push(classMatch);
        logger.info(`Matched keyword "${keyword}" with class: ${classMatch.label}`);
        continue;
      }

      const aliasMatch = await this.aliasRepo
        .createQueryBuilder('oa')
        .where('oa.alias LIKE :keyword', { keyword: `%${keyword}%` })
        .getOne();

      if (aliasMatch) {
        const ontologyClass = await this.ontologyRepo.findOne(aliasMatch.class);
        matchedClasses.push(ontologyClass);
        logger.info(`Matched keyword "${keyword}" with alias leading to class: ${ontologyClass?.label}`);
      } else {
        logger.info(`No match found for keyword: ${keyword}`);
      }
    }

    logger.info(
      'Keyword matching completed with matched classes:',
      matchedClasses.map((mc) => mc?.label),
    );

    return matchedClasses.length > 0 ? matchedClasses : null;
  }
}
