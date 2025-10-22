import { Request, Response, NextFunction } from 'express';

export const enum roles {
		admin = "admin",
		contributor = "contributor",
}

/**
 * Middleware wrapper to check role of client in accessing routes
 *
 * Usage:
 * 		app.use('/route', checkRole("admin"), router)
 *
 * @param {roles} role Role required to access route
 * @returns {function} Middleware that performs the relevant checks
 */
export function checkRole(role: roles): (req: Request, res: Response, next: NextFunction) => void {
		return (req: Request, res: Response, next: NextFunction) => {
				if (!req.oidc.isAuthenticated()) {
						res.status(401).send("Login Required");
				}
				const rolesClaim = req.oidc?.user?.["https://roles"] as string[] | undefined;
				if (rolesClaim?.includes(role)) {
						next()
				}
				else
					res.status(403).send(`Role ${role} required to access resource`);
		}
}
