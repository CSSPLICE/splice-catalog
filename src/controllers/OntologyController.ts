import { Request, Response } from 'express';
import { AppDataSource } from '../db/data-source.js';
import { OntologyClasses } from '../db/entities/OntologyClass.js';
import { OntologyRelations } from '../db/entities/OntologyRelation.js';

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
      const relationRepository = AppDataSource.getRepository(OntologyRelations);
      const excludedLabels = this.excludedLabels().map((label) => label.toLowerCase());

      const classes = await ontologyRepository.find({
        where: { is_active: true },
      });
      const relations = await relationRepository.find({
        relations: ['parent_class', 'child_class'],
      });

      const classById = new Map<number, OntologyClasses>();
      const childIds = new Set<number>();
      const childrenByParentId = new Map<number, OntologyClasses[]>();

      classes.forEach((classItem) => {
        if (!excludedLabels.includes(classItem.label.toLowerCase())) {
          classById.set(classItem.id, classItem);
        }
      });

      relations.forEach((relation) => {
        const parent = relation.parent_class as OntologyClasses | undefined;
        const child = relation.child_class as OntologyClasses | undefined;
        if (!parent || !child || !classById.has(parent.id) || !classById.has(child.id)) return;

        childIds.add(child.id);
        const siblings = childrenByParentId.get(parent.id) || [];
        if (!siblings.some((sibling) => sibling.id === child.id)) {
          siblings.push(child);
        }
        childrenByParentId.set(parent.id, siblings);
      });

      const buildNode = (classItem: OntologyClasses, visited = new Set<number>()): any => {
        const nextVisited = new Set(visited);
        nextVisited.add(classItem.id);

        const children = (childrenByParentId.get(classItem.id) || [])
          .filter((child) => !nextVisited.has(child.id))
          .sort((left, right) => left.label.localeCompare(right.label))
          .map((child) => buildNode(child, nextVisited));

        return {
          id: classItem.id,
          label: classItem.label.replace(/_/g, ' '),
          children,
        };
      };

      const treeData = Array.from(classById.values())
        .filter((classItem) => !childIds.has(classItem.id))
        .sort((left, right) => left.label.localeCompare(right.label))
        .map((classItem) => buildNode(classItem));

      res.json({ tree: treeData });
    } catch (error) {
      console.error('Error fetching ontology tree:', error);
      res.status(500).send('Internal Server Error');
    }
  }
}
