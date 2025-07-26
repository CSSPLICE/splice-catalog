import { KeywordMatch } from './KeywordMatch.js';
import { OntologyClasses } from '../db/entities/OntologyClass.js';
import logger from '../utils/logger.js';
import { AppDataSource } from '../db/data-source.js';
import { SLCItem, MatchedItem } from '../types/ItemTypes.js';

export class CategoryReport {
  private matcher = new KeywordMatch();
  private ontologyRepo = AppDataSource.getRepository(OntologyClasses);

  public async generateReport(items: SLCItem[]): Promise<{
    matched: MatchedItem[];
    unclassified: MatchedItem[];
    unmatched: MatchedItem[];
  }> {
    const matched: MatchedItem[] = [];
    const unclassified: MatchedItem[] = [];
    const unmatched: MatchedItem[] = [];

    for (const item of items) {
      logger.info(`Processing item: ${item.exercise_name}`);
      const matchedClasses = await this.matcher.matchKeywordsToOntology({
        keywords: item.keywords || [],
      });

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
      unmatched,
    };
  }
}
