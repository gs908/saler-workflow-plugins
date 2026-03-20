const express = require('express'),
    router = express.Router(),
    Mock=require('mockjs');

/* GET users listing. */
router.get('/', function(req, res, next) {
  res.send('this is a users response!');
});

router.get('/json', function(req, res, next) {
    res.json(Mock.mock({
        'data|100':[{
            'id|+1':100,
            'createTime|+5000':Date.now()
        }]
    }));
});

module.exports = router;
