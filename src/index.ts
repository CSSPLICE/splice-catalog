console.log('Starting...');

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

import * as dotenv from 'dotenv';
import 'reflect-metadata';
import app from './app.js';
import { AppDataSource } from './db/data-source.js';
import logger from './utils/logger.js';
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

    app.use((req, res, next) => {
      res.locals.user = req.oidc && req.oidc.user ? req.oidc.user : null;
      res.locals.showLoginButton = req.path.startsWith('/upload');
    });

    server.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
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
  } catch (err) {
    logger.error('Failed to start server', err);
    process.exit(1);
  }
}

startServer();
