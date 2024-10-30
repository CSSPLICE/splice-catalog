import { KeywordMatch } from './KeywordMatch';
import { OntologyClasses } from '../db/entities/OntologyClass';
import logger from '../utils/logger';
import { AppDataSource } from '../db/data-source';

export class CategoryReport {
  private matcher = new KeywordMatch();
  private ontologyRepo = AppDataSource.getRepository(OntologyClasses);

  public async generateReport(items: any[]) {
    const matched = [];
    const unclassified = [];
    const unmatched = [];

    for (const item of items) {
      logger.info(`Processing item: ${item.exercise_name}`);
      const matchedClasses = await this.matcher.matchKeywordsToOntology(item);

      if (matchedClasses && matchedClasses.length > 0 && matchedClasses[0]) {
        matched.push({ item, matchedClass: matchedClasses[0].label });
      } else {
        const unclassifiedClass = await this.ontologyRepo.findOne({ where: { label: 'Unclassified' } });
        if (unclassifiedClass) {
          unclassified.push({ item, matchedClass: 'Unclassified' });
        } else {
          unmatched.push({ item, matchedClass: 'None' });
        }
      }
    }

    return {
      matched,
      unclassified,
      unmatched
    };
  }
}
