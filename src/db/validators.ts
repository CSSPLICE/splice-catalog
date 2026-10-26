import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';
import { BaseEntity } from 'typeorm';

export function Duplicate(opts?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'duplicate',
      target: object.constructor,
      propertyName: propertyName,
      options: opts,
      validator: {
        async validate(value: unknown, args: ValidationArguments) {
          if (typeof value !== 'string' || !value) return true;
          const EntityClass = args.object.constructor as typeof BaseEntity & {
            getRepository: () => { findOne: (o: object) => Promise<unknown> };
          };
          const existing = await EntityClass.getRepository().findOne({
            where: { [args.property]: value },
          });
          return !existing;
        },
        defaultMessage(args?: ValidationArguments): string {
          return <string>opts?.message || `existing record with ${args?.property} "${args?.value}" was updated`;
        },
      },
    });
  };
}

export function Reachable(opts?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'reachable',
      target: object.constructor,
      propertyName: propertyName,
      options: opts,
      validator: {
        async validate(value: string) {
          try {
            const result = await fetch(value, { method: 'HEAD' });
            return result.ok;
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
          } catch (e) {
            return false;
          }
        },
        defaultMessage(args?: ValidationArguments): string {
          return <string>opts?.message || `url ${args?.value} for field ${args?.property} could not be reached`;
        },
      },
    });
  };
}
