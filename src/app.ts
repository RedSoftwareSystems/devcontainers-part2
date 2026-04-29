import express from 'express';
import { healthRouter } from './routes/health';

const app = express();

app.use(express.json());

app.use('/health', healthRouter);

app.get('/', (_req, res) => {
  res.json({
    message: 'Dev Containers — Part 2 sample API',
    docs: 'https://github.com/your-org/devcontainers-part2',
  });
});

export default app;
