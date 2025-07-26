import { AppDataSource } from '../db/data-source.js';
import { OntologyClasses } from '../db/entities/OntologyClass.js';
import { OntologyAliases } from '../db/entities/OntologyAlias.js';
import logger from '../utils/logger.js';
import { Metadata } from '../types/ItemTypes.js';

export class KeywordMatch {
  private ontologyRepo = AppDataSource.getRepository(OntologyClasses);
  private aliasRepo = AppDataSource.getRepository(OntologyAliases);

  public async matchKeywordsToOntology(metadata: Metadata): Promise<OntologyClasses[] | null> {
    try {
      if (!metadata?.keywords || !Array.isArray(metadata.keywords)) {
        logger.warn('Invalid or missing keywords in metadata');
        return null;
      }

      const matchedClasses: OntologyClasses[] = [];
      logger.info(`Starting keyword matching for: ${JSON.stringify(metadata.keywords)}`);

      for (const keyword of metadata.keywords) {
        try {
          if (!keyword || typeof keyword !== 'string') {
            logger.warn('Skipping invalid keyword:', keyword);
            continue;
          }

          logger.debug(`Processing keyword: ${keyword}`);

          // Try direct class match first
          const classMatch = await this.findClassMatch(keyword);
          if (classMatch) {
            matchedClasses.push(classMatch);
            continue;
          }

          // Try alias match if no direct class match found
          const aliasMatch = await this.findAliasMatch(keyword);
          if (aliasMatch) {
            matchedClasses.push(aliasMatch);
          }
        } catch (error) {
          logger.error(`Error processing keyword "${keyword}":`, error);
          continue;
        }
      }

      logger.info(
        'Keyword matching completed. Matched classes:',
        matchedClasses.map((mc) => mc.label),
      );

      return matchedClasses.length > 0 ? matchedClasses : null;
    } catch (error) {
      logger.error('Error in matchKeywordsToOntology:', error);
      throw error;
    }
  }

  private async findClassMatch(keyword: string): Promise<OntologyClasses | null> {
    try {
      const classMatch = await this.ontologyRepo
        .createQueryBuilder('oc')
        .where('LOWER(oc.label) LIKE LOWER(:keyword)', { keyword: `%${keyword}%` })
        .getOne();

      if (classMatch) {
        logger.debug(`Found direct class match: ${classMatch.label} for keyword: ${keyword}`);
      }
      return classMatch;
    } catch (error) {
      logger.error(`Error in findClassMatch for keyword "${keyword}":`, error);
      return null;
    }
  }

  private async findAliasMatch(keyword: string): Promise<OntologyClasses | null> {
    try {
      const aliasMatch = await this.aliasRepo
        .createQueryBuilder('oa')
        .leftJoinAndSelect('oa.class', 'class')
        .where('LOWER(oa.alias) LIKE LOWER(:keyword)', { keyword: `%${keyword}%` })
        .getOne();

      if (aliasMatch?.class) {
        logger.debug(`Found alias match: ${aliasMatch.class.label} for keyword: ${keyword}`);
        return aliasMatch.class;
      }
      return null;
    } catch (error) {
      logger.error(`Error in findAliasMatch for keyword "${keyword}":`, error);
      return null;
    }
  }
}
