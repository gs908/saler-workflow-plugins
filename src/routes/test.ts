import { Router, Request, Response } from 'express';

const router = Router();

/* GET test page. */
router.get('/', (req: Request, res: Response) => {
    res.json({
        message: 'Hello from TypeScript route!',
        timestamp: Date.now()
    });
});

export default router;
