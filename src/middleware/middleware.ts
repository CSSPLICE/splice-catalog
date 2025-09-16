import { Request, Response, NextFunction } from 'express';

export enum roles {
		admin = "admin",
		contributor = "contributor",
}

export function checkRole(role: roles): (req: Request, res: Response, next: NextFunction) => void {
		return (req: Request, res: Response, next: NextFunction) => {
				if (!req.oidc.isAuthenticated()) {
						res.status(401).send("Login Required");
				}
				if (req.oidc?.user["https://roles"].includes(role)) {
						next()
				}
				else
					res.status(403).send(`Role ${role} required to access resource`);
		}
}