import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
dotenv.config();

export const AppDataSource: DataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT) || 3306,
  username: process.env.DB_USER || 'splice',
  password: process.env.DB_PASSWORD || 'splice',
  database: process.env.DB_DATABASE || 'splice',
  migrations: ['./src/db/migrations/*.ts'],
  logging: process.env.ORM_LOGGING === 'true',
  entities: ['./src/db/entities/*.ts'],
  synchronize: false,
  subscribers: [],
  migrationsRun: false,
});
