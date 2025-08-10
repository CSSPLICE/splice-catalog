import cors from 'cors';
import helmet from 'helmet';
import express, { Express } from 'express';
import catalogRoutes from './routes/catalog.js';
import aboutRoutes from './routes/about.js';
import searchRoutes from './routes/search.js';
import viewRoutes from './routes/view.js';
import reviewRoutes from './routes/review.js';
import ontologyRoutes from './routes/ontology.js';
import { ErrorHandler } from './utils/ErrorHandler.js';
import { fileURLToPath } from 'url';
import path from 'path';
import { auth } from 'express-openid-connect';
import * as dotenv from 'dotenv';
import { setup } from './admin-panel/adminjs-setup.js'
import { AppDataSource } from './db/data-source.js';
import { EventEmitter } from 'events';

const emitter = new EventEmitter();
(async () => {
  try {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize().then(() => {emitter.emit('DataSourceInitialized')});
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

emitter.on('DataSourceInitialized',
  () => {
    console.log('DataSourceInitialized')
  }
)
emitter.on('DataSourceInitialized', () => {
  const adminRouter = setup();
  app.use('/admin', adminRouter);
})

app.use(ErrorHandler.handleErrors);

export default app;
