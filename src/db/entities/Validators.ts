import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions
} from 'class-validator';

@ValidatorConstraint({ name: 'ValidURL', async: true })
export class ValidURLConstraint implements ValidatorConstraintInterface {

  async validate(url: string) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response.status >= 200 && response.status < 400;
    } catch (error: Error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        console.warn(`URL validation for "${url}" timed out.`);
      } else {
        console.warn(
          `URL validation failed for "${url}": ${error.message}`,
        );
      }
      return false;
    }
  }


  defaultMessage() {
    return 'Text ($value) is too short or too long!';
  }
}

export function IsLongerThan(property: string, validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isLongerThan',
      target: object.constructor,
      propertyName: propertyName,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          const [relatedPropertyName] = args.constraints;
          const relatedValue = (args.object as any)[relatedPropertyName];
          return typeof value === 'string' &&
               typeof relatedValue === 'string' &&
               value.length > relatedValue.length;
        }
      }
    });
    };
}