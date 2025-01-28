import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source';
import { OntologyClasses } from '../db/entities/OntologyClass';

export class OntologyController {
  // Fetch ontology tiles data for parents
  async getOntologyTilesData(req: Request, res: Response) {
    try {
      const parentId = req.query.parentId ? parseInt(req.query.parentId as string, 10) : null;
      const { categories, breadcrumb } = await this.fetchCategoriesAndBreadcrumb(parentId);

      // Map categories to view
      const categoryData = categories.map((cat) => ({
        id: cat.id,
        label: cat.label.replace(/_/g, ' '),
      }));

      res.json({ categories: categoryData, breadcrumb });
    } catch (error) {
      console.error('Error fetching ontology categories:', error);
      res.status(500).send('Internal Server Error');
    }
  }

  // Fetch child categories for a given parent
  async getChildCategories(req: Request, res: Response) {
    try {
      const parentId = parseInt(req.params.parentId, 10);

      if (isNaN(parentId)) {
        return res.status(400).json({ error: 'Invalid parent ID' });
      }
      const { categories, breadcrumb } = await this.fetchCategoriesAndBreadcrumb(parentId);

      // Map categories to the view
      const childCategoryData = categories.map((cat) => ({
        id: cat.id,
        label: cat.label.replace(/_/g, ' '),
      }));

      res.json({ categories: childCategoryData, breadcrumb });
    } catch (error) {
      console.error('Error fetching child categories:', error);
      res.status(500).send('Internal Server Error');
    }
  }

  // Render the ontology tiles page
  async viewOntologyTiles(req: Request, res: Response) {
    try {
      res.render('pages/ontologyTiles', {
        title: 'Ontology Browser',
        description: 'Explore the SPLICE Ontology and navigate through categories and subcategories.',
      });
    } catch (error) {
      console.error('Error rendering ontology tiles page:', error);
      res.status(500).send('Internal Server Error');
    }
  }

  // fetch categories and breadcrumbs
  private async fetchCategoriesAndBreadcrumb(parentId: number | null): Promise<{
    categories: OntologyClasses[];
    breadcrumb: { id: number; label: string }[];
  }> {
    const ontologyRepository = AppDataSource.getRepository(OntologyClasses);
    let categories;

    if (parentId === null) {
      // Fetch top-level categories
      categories = await ontologyRepository
        .createQueryBuilder('class')
        .where(
          `NOT EXISTS (
            SELECT 1 
            FROM ontology_relations rel 
            WHERE rel.child_class_id = class.id
          )`,
        )
        .andWhere('class.label NOT IN (:...excludedLabels)', {
          excludedLabels: this.excludedLabels(),
        })
        .getMany();
    } else {
      // Fetch child categories for the given parent
      categories = await ontologyRepository
        .createQueryBuilder('class')
        .innerJoin('ontology_relations', 'rel', 'rel.child_class_id = class.id')
        .where('rel.parent_class_id = :parentId', { parentId })
        .andWhere('class.label NOT IN (:...excludedLabels)', {
          excludedLabels: this.excludedLabels(),
        })
        .getMany();
    }
    const breadcrumb = await this.buildBreadcrumb(parentId);
    return { categories, breadcrumb };
  }

  // Build the breadcrumb trail
  private async buildBreadcrumb(parentId: number | null): Promise<{ id: number; label: string }[]> {
    const breadcrumb: { id: number; label: string }[] = [];
    if (parentId === null) {
      return breadcrumb;
    }

    const ontologyRepository = AppDataSource.getRepository(OntologyClasses);
    let current = await ontologyRepository.findOne({
      where: { id: parentId },
      relations: ['parentRelations', 'parentRelations.parent_class'],
    });

    while (current) {
      breadcrumb.unshift({
        id: current.id,
        label: current.label.replace(/_/g, ' '),
      });
      const parentRelation = current.parentRelations?.[0];
      current = parentRelation?.parent_class || null;
    }
    return breadcrumb;
  }
  // exclude this labels from the results
  private excludedLabels(): string[] {
    return [
      'unclassified',
      'root',
      'java scanner class',
      'command line parameters',
      'command line interface',
      'factorial algorithms',
      'Problem Solving Heuristics',
      'Algorithm Definition',
    ];
  }

  // Fetch the full parent-child ontology tree
  async getOntologyTree(req: Request, res: Response) {
    try {
      const ontologyRepository = AppDataSource.getRepository(OntologyClasses);
      const ontologyTree = await ontologyRepository.find({
        relations: ['childRelations', 'childRelations.child_class'],
      });

      const treeData = ontologyTree.map((classItem) => ({
        id: classItem.id,
        label: classItem.label.replace(/_/g, ' '),
        children: classItem.childRelations.map((relation) => ({
          id: relation.child_class.id,
          label: relation.child_class.label.replace(/_/g, ' '),
        })),
      }));

      res.json({ tree: treeData });
    } catch (error) {
      console.error('Error fetching ontology tree:', error);
      res.status(500).send('Internal Server Error');
    }
  }
}
