import { Router } from 'express';
const router = Router();

router.get('/', (_req, res) => {
  res.render('subtitle-video', { title: '字幕视频生成' });
});

export default router;
