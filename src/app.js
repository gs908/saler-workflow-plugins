// Load environment variables from .env file
require('dotenv').config({override: true});

// Register ts-node for TypeScript support
require('ts-node').register({
    transpileOnly: true,
    compilerOptions: {
        module: 'commonjs',
        target: 'ES2020'
    }
});

const createError = require('http-errors'),
    express = require('express'),
    cookieParser = require('cookie-parser'),
    logger = require('morgan'),
    cors=require('cors'),
    app = express(),
    path = require('path'),
    fs = require('fs'),
    scanner = require('route-scanner');

// view engine setup
app.engine('hbs',require('hbs').__express);
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));


app.use(logger('saler-workflow-plugins'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

//  add cors
app.use(cors());
const prefix = 'saler-plugins';
//  load routers
scanner(app,{
    debug:false,
    routerPath: path.join(__dirname, 'routes'),
    prefix:prefix,   //  modifier
    replacePaths:[{
        from:'/index',
        to:'/'
    }],
    /*extraMaps:[{
        rootPath:path.join(__dirname, '/other-paths'),
        fileMaps:[{
            url:'/admin',
            file:'admin.js'
        }]
    }]*/
});

// Manual TypeScript route scanning (route-scanner doesn't support .ts)
const routesPath = path.join(__dirname, 'routes');


function scanTsRoutes(dir, urlPrefix = '') {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
        const fullPath = path.join(dir, file.name);
        if (file.isDirectory()) {
            scanTsRoutes(fullPath, `${urlPrefix}/${file.name}`);
        } else if (file.name.endsWith('.ts')) {
            const routeName = file.name.replace('.ts', '');
            const routeUrl = `${urlPrefix}/${routeName}`.replace('/index', '/');
            const fullUrl = `/${prefix}${routeUrl}`;
            const router = require(fullPath);
            // Handle ES module default export
            const routeModule = router.default || router;
            app.use(fullUrl, routeModule);
            console.log(`[TS] Registered router [${fullUrl}] -> ${fullPath}`);
        }
    }
}
scanTsRoutes(routesPath);

// Manual route for workflow-test page
const workflowTestRouter = require('./routes/workflow-test');
app.use('/saler-plugins/workflow-test', workflowTestRouter);

// 视频切片服务
const { default: sliceRouter } = require('./services/video-slice/router');
const { config: sliceConfig } = require('./services/video-slice/config');
// HLS 静态文件托管（playlist_url 依赖此路径）
app.use(sliceConfig.hlsUrlPathPrefix, express.static(sliceConfig.hlsOutputDir));
app.use('/slice', sliceRouter);


// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  var status = err.status || 500;
  if (req.headers.accept && req.headers.accept.indexOf('application/json') !== -1) {
    res.status(status).json({ error: err.message, status: status });
  } else {
    res.status(status);
    res.render('error', { message: err.message, error: err });
  }
});

module.exports = app;
