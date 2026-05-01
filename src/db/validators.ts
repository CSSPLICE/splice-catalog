import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

const shouldValidateReachability = (): boolean => {
  return process.env.VALIDATE_REACHABILITY === 'true';
};

const toUrlList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return [value.trim()].filter(Boolean);
  }

  return [];
};

export function Reachable(opts?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'reachable',
      target: object.constructor,
      propertyName: propertyName,
      options: opts,
      validator: {
        async validate(value: unknown) {
          if (!shouldValidateReachability()) {
            return true;
          }

          const urls = toUrlList(value);
          if (urls.length === 0) {
            return true;
          }

          try {
            const results = await Promise.all(
              urls.map(async (url) => {
                const result = await fetch(url, { method: 'HEAD' });
                return result.ok;
              }),
            );
            return results.every(Boolean);
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
