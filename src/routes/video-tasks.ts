import { Router } from 'express';
const router = Router();

router.get('/', (_req, res) => {
  res.render('video-tasks', { title: '视频任务管理' });
});

export default router;
