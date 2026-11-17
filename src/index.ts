console.log('Starting...');

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

import * as dotenv from 'dotenv';
import 'reflect-metadata';
import app, { databaseReady } from './app.js';
import { AppDataSource } from './db/data-source.js';
import { cleanupUsageEventAudit, startAuditRetentionWorker } from './services/LiveUsageAuditRetention.js';
import logger from './utils/logger.js';
import http from 'http';
import { Server } from 'socket.io';

dotenv.config();

const PORT = process.env.APP_PORT || 3000;

async function startServer() {
  try {
    const stopProvisionalWorker = await databaseReady;
    logger.info('Database connection success');

    const server = http.createServer(app);
    const io = new Server(server);

    app.use((req, res, next) => {
      res.locals.io = io;
      next();
    });

    io.on('connection', (socket) => {
      logger.info('Socket  connected:', socket.id);
    });

    app.all('*', (req, res) => {
      return res.status(404).send({
        success: false,
        message: 'Invalid route',
      });
    });

    let stopAuditRetention = async () => {};
    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      try {
        await Promise.all([
          stopProvisionalWorker(),
          stopAuditRetention(),
          new Promise<void>((resolve, reject) => {
            void io.close((error) => error ? reject(error) : resolve()).catch(reject);
          }),
        ]);
        await AppDataSource.destroy();
      } catch (error) {
        logger.error('Failed to shut down server', error);
        process.exitCode = 1;
      }
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    server.once('close', () => void stopAuditRetention());
    server.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
      if (!shuttingDown) {
        stopAuditRetention = startAuditRetentionWorker(() => cleanupUsageEventAudit(AppDataSource), logger);
      }
    });
  } catch (err) {
    logger.error('Failed to start server', err);
    process.exit(1);
  }
}

startServer();
