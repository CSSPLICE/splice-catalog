import {registerDecorator, ValidationArguments, ValidationOptions} from 'class-validator';

export function Reachable(opts?: ValidationOptions) {
	return function (object: object, propertyName: string) {
		registerDecorator({
			name: 'reachable',
			target: object.constructor,
			propertyName: propertyName,
			options: opts,
			validator: {
				async validate(value: string) {
					console.log(`type: ${ typeof value } value: ${value}`);
					try {
						const result = await fetch(value, {method: 'HEAD'});
						console.log(`res:${ result }`);
						return result.ok;
						// eslint-disable-next-line @typescript-eslint/no-unused-vars
					} catch (e) {
						return false;
					}
				},
				defaultMessage(args?: ValidationArguments): string {
					return <string>opts?.message || `url ${args?.value} for field ${args?.property} could not be reached`
				}
			}
		});
	};
}