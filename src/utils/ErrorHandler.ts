import { ValidationError } from 'class-validator';
import { NextFunction, Request, Response } from 'express';
import { EntityNotFoundError } from 'typeorm';
import { ResponseUtil } from './Response';
import logger from './logger';

export class ErrorHandler {
  static handleErrors(err: Error, req: Request, res: Response, next: NextFunction) {
    console.error(err);
    if (err instanceof EntityNotFoundError) {
      logger.error(err.message);
      return ResponseUtil.sendError(res, 'Item/page you are looking for does not exist', 404, err);
    }

    if (err instanceof ValidationError) {
      logger.error(err.message);
      return ResponseUtil.sendError(res, 'Invalid input', 422, err);
    }

    if (err.message === 'Invalid file type') {
      logger.error(err.message);
      return ResponseUtil.sendError(res, 'Invalid file type', 422, err);
    }

    return res.status(500).send({
      success: false,
      message: 'Something went wrong',
    });
  }
}
