import cors from 'cors';
import helmet from 'helmet';
import express, { Express } from 'express';
import catalogRoutes from './routes/catalog';
import aboutRoutes from './routes/about';
import searchRoutes from './routes/search';
import viewRoutes from './routes/view';
import reviewRoutes from './routes/review';
import ontologyRoutes from './routes/ontology';
import { ErrorHandler } from './utils/ErrorHandler';
import path from 'path';
import { auth } from 'express-openid-connect';
import * as dotenv from 'dotenv';
import { AppDataSource } from './db/data-source';

(async () => {
  try {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      console.log('Database connection initialized successfully!');
    }
  } catch (error) {
    console.error('Error initializing database connection:', error);
    process.exit(1); // Exit the process if the database fails to initialize
  }
})();

dotenv.config();

const app: Express = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

if (process.env.NODE_ENV === 'production') {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'frame-src': ['codeworkoutdev.cs.vt.edu', 'opendsax.cs.vt.edu', 'acos.cs.vt.edu', 'codecheck.io'],
          'script-src': ["'self'", 'splice.cs.vt.edu', 'cdn.jsdelivr.net'],
        },
        reportOnly: true,
      },
    }),
  );
}

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
app.use('/about', aboutRoutes);
app.use('/catalog', catalogRoutes);
app.use('/search', searchRoutes);
app.use('/', reviewRoutes);
app.use('/approve', reviewRoutes);
app.use('/ontology', ontologyRoutes);

app.use(ErrorHandler.handleErrors);

export default app;
