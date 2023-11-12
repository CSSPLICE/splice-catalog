import * as dotenv from 'dotenv';
import 'reflect-metadata';
import app from './app';
import { AppDataSource } from './db/data-source';
import logger from './utils/logger';

dotenv.config();

const PORT = process.env.APP_PORT || 3000;

AppDataSource.initialize()
  .then(async () => {
    logger.log('info', 'Database connection success');
  })
  .catch((err) => console.log(err));

app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
});
