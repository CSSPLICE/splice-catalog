import cors from 'cors';
import helmet from 'helmet';
import express, { Express, Request, Response } from 'express';
import http from 'http';
import { Server } from 'socket.io';
import catalogRoutes from './routes/catalog';
import searchRoutes from './routes/search';
import viewRoutes from './routes/view';
import reviewRoutes from './routes/review';
import { ErrorHandler } from './utils/ErrorHandler';
import path from 'path';
import { auth } from 'express-openid-connect';
import * as dotenv from 'dotenv';

dotenv.config();

const app: Express = express();

const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

if (process.env.NODE_ENV === 'production') {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'frame-src': ['codeworkoutdev.cs.vt.edu', 'opendsax.cs.vt.edu', 'acos.cs.vt.edu'],
          'script-src': ['splice.cs.vt.edu', 'cdn.jsdelivr.net'],
        },
      },
    }),
  );
}

//add Socket
app.use((req, res, next) => {
  res.locals.io = io;
  next();
});

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

const oidc_config = {
  authRequired: false,
  auth0Logout: true,
  secret: process.env.SECRET,
  baseURL: process.env.baseURL,
  clientID: process.env.clientID,
  issuerBaseURL: process.env.issuerBaseURL,
};

app.use(auth(oidc_config));

app.use('/', viewRoutes);

app.use('/catalog', catalogRoutes);
app.use('/search', searchRoutes);

app.use('/', reviewRoutes);
app.use('/approve', reviewRoutes);

app.use('/ontology', ontologyRoutes);

app.all('*', (req: Request, res: Response) => {
  return res.status(404).send({
    success: false,
    message: 'Invalid route',
  });
});

app.use(ErrorHandler.handleErrors);

export default app;
