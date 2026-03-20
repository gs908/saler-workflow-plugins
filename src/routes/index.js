const express = require('express'),
    router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', {
      title: 'Fake API Server',
      subTitle:'——used to support fake api service'
  });
});

module.exports = router;
