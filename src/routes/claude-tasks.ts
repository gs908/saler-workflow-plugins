import { Router, Request, Response } from 'express';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.render('claude-tasks', {
    title: 'Claude Code 任务管理',
  });
});

export default router;
