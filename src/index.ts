console.log('Starting...');

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

import * as dotenv from 'dotenv';
import 'reflect-metadata';
import app from './app';
import { AppDataSource } from './db/data-source';
import logger from './utils/logger';
import http from 'http';
import { Server } from 'socket.io';

dotenv.config();

const PORT = process.env.APP_PORT || 3000;

async function startServer() {
  try {
    await AppDataSource.initialize();
    logger.info('Database connection success');

    const server = http.createServer(app);
    const io = new Server(server);

    app.use((req, res, next) => {
      res.locals.io = io;
      next();
    });

    server.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
    });

    io.on('connection', (socket) => {
      logger.info('Socket  connected:', socket.id);
    });
  } catch (err) {
    logger.error('Failed to start server', err);
    process.exit(1);
  }
}

startServer();
