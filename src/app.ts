import cors from 'cors';
import helmet from 'helmet';
import express, { Express, Request, Response } from 'express';
import catalogRoutes from './routes/catalog';
import searchRoutes from './routes/search';
import viewRoutes from './routes/view';
import { ErrorHandler } from './utils/ErrorHandler';
import path from 'path';


const app: Express = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

if (process.env.NODE_ENV === 'production') {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
	  "frame-src": ["codeworkoutdev.cs.vt.edu", "opendsax.cs.vt.edu"],
        },
      },
    })
  );
}

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use('/', viewRoutes);

app.use('/catalog', catalogRoutes);
app.use('/search', searchRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.all('*', (req: Request, res: Response) => {
  return res.status(404).send({
    success: false,
    message: 'Invalid route',
  });
});

app.use(ErrorHandler.handleErrors);

export default app;
