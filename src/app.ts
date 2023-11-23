import bodyParser from 'body-parser';
import cors from 'cors';
import helmet from 'helmet';
import express, { Express, Request, Response } from 'express';
import catalogRoutes from './routes/catalog';
import searchRoutes from './routes/search';
import viewRoutes from './routes/view';
import { ErrorHandler } from './utils/ErrorHandler';
import path from 'path';
// import logger from './utils/logger';

const app: Express = express();

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

if (process.env.NODE_ENV === 'production') {
  app.use(helmet());
}

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use('/', viewRoutes);

app.use('/catalog', catalogRoutes);
app.use('/search', searchRoutes);

app.all('*', (req: Request, res: Response) => {
  return res.status(404).send({
    success: false,
    message: 'Invalid route',
  });
});

app.use(ErrorHandler.handleErrors);

export default app;
